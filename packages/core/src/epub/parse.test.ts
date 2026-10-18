import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseEpub } from './parse.ts';
import { buildEpub, CONTENT_OPF } from './test-helpers.ts';

function encryptionXml(algorithm: string, uri: string): string {
  return `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="${algorithm}"/>
    <enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`;
}

function errorCode(bytes: Uint8Array) {
  const result = parseEpub(bytes);
  return result.ok ? null : result.error.code;
}

describe('parseEpub: a valid book', () => {
  const result = parseEpub(buildEpub());
  if (!result.ok) throw new Error(result.error.message);
  const { book, warnings } = result;

  it('reads metadata, spine and toc', () => {
    expect(book.version).toBe('2.0');
    expect(book.opfPath).toBe('OEBPS/content.opf');
    expect(book.metadata).toEqual({
      title: 'Test Book',
      creators: ['Test Author'],
      languages: ['en'],
      identifier: 'urn:uuid:12345',
      coverId: null,
    });
    expect(book.spine.map((s) => s.href)).toEqual(['OEBPS/Text/ch1.xhtml']);
    expect(book.tocSource).toBe('ncx');
    expect(book.toc.map((t) => t.title)).toEqual(['Chapter 1']);
    expect(warnings).toEqual([]);
  });

  it('reads files through readText and readBytes', () => {
    expect(book.readText('OEBPS/Text/ch1.xhtml')).toContain('<h1>Chapter 1</h1>');
    expect(book.readBytes('OEBPS/Styles/style.css')).toEqual(strToU8('p { text-indent: 2em; }'));
    expect(book.readText('OEBPS/Text/missing.xhtml')).toBeNull();
  });
});

describe('parseEpub: NOT_EPUB / TOO_LARGE', () => {
  it('rejects non-zip data', () => {
    expect(errorCode(strToU8('%PDF-1.7 not an epub'))).toBe('NOT_EPUB');
  });

  it('rejects a zip without container.xml', () => {
    expect(errorCode(buildEpub({ 'META-INF/container.xml': null }))).toBe('NOT_EPUB');
  });

  it('rejects files over the limit', () => {
    const result = parseEpub(buildEpub(), { maxFileBytes: 100, maxUnzippedBytes: 1e9 });
    expect(result).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } });
  });
});

describe('parseEpub: mimetype', () => {
  it('only warns when mimetype is missing', () => {
    const result = parseEpub(buildEpub({ mimetype: null }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.map((w) => w.code)).toEqual(['MIMETYPE_INVALID']);
  });
});

describe('parseEpub: DRM_PROTECTED', () => {
  it('detects Adobe rights.xml', () => {
    expect(errorCode(buildEpub({ 'META-INF/rights.xml': '<rights/>' }))).toBe('DRM_PROTECTED');
  });

  it('detects encrypted content', () => {
    const xml = encryptionXml(
      'http://www.w3.org/2001/04/xmlenc#aes128-cbc',
      'OEBPS/Text/ch1.xhtml',
    );
    expect(errorCode(buildEpub({ 'META-INF/encryption.xml': xml }))).toBe('DRM_PROTECTED');
  });

  it('does not treat font obfuscation as DRM', () => {
    for (const algorithm of [
      'http://www.idpf.org/2008/embedding',
      'http://ns.adobe.com/pdf/enc#RC',
    ]) {
      const xml = encryptionXml(algorithm, 'OEBPS/Fonts/a.ttf');
      expect(errorCode(buildEpub({ 'META-INF/encryption.xml': xml }))).toBeNull();
    }
  });
});

describe('parseEpub: CORRUPTED', () => {
  it('when container.xml has no rootfile', () => {
    const container = '<container><rootfiles/></container>';
    expect(errorCode(buildEpub({ 'META-INF/container.xml': container }))).toBe('CORRUPTED');
  });

  it('when the OPF file is missing', () => {
    expect(errorCode(buildEpub({ 'OEBPS/content.opf': null }))).toBe('CORRUPTED');
  });

  it('when the OPF is not an OPF', () => {
    expect(errorCode(buildEpub({ 'OEBPS/content.opf': '<html/>' }))).toBe('CORRUPTED');
  });

  it('when none of the spine files exist', () => {
    expect(errorCode(buildEpub({ 'OEBPS/Text/ch1.xhtml': null }))).toBe('CORRUPTED');
  });

  it('only warns when some spine files are missing', () => {
    const opf = CONTENT_OPF.replace(
      '</manifest>',
      '<item id="ch2" href="Text/ch2.xhtml" media-type="application/xhtml+xml"/></manifest>',
    ).replace('<itemref idref="ch1"/>', '<itemref idref="ch1"/><itemref idref="ch2"/>');
    const result = parseEpub(buildEpub({ 'OEBPS/content.opf': opf }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.map((w) => w.code)).toEqual(['SPINE_FILES_MISSING']);
  });
});

describe('parseEpub: FIXED_LAYOUT', () => {
  it('detects rendition:layout', () => {
    const opf = CONTENT_OPF.replace(
      '</metadata>',
      '<meta property="rendition:layout">pre-paginated</meta></metadata>',
    );
    expect(errorCode(buildEpub({ 'OEBPS/content.opf': opf }))).toBe('FIXED_LAYOUT');
  });

  it('detects Apple display options', () => {
    const xml =
      '<display_options><platform name="*"><option name="fixed-layout">true</option></platform></display_options>';
    expect(errorCode(buildEpub({ 'META-INF/com.apple.ibooks.display-options.xml': xml }))).toBe(
      'FIXED_LAYOUT',
    );
  });

  it('ignores Apple display options without fixed-layout', () => {
    const xml =
      '<display_options><platform name="*"><option name="specified-fonts">true</option></platform></display_options>';
    expect(
      errorCode(buildEpub({ 'META-INF/com.apple.ibooks.display-options.xml': xml })),
    ).toBeNull();
  });
});

describe('parseEpub: VERTICAL_LAYOUT', () => {
  it('detects rtl page progression', () => {
    const opf = CONTENT_OPF.replace(
      '<spine toc="ncx">',
      '<spine toc="ncx" page-progression-direction="rtl">',
    );
    expect(errorCode(buildEpub({ 'OEBPS/content.opf': opf }))).toBe('VERTICAL_LAYOUT');
  });

  it('detects Kindle primary-writing-mode', () => {
    const opf = CONTENT_OPF.replace(
      '</metadata>',
      '<meta name="primary-writing-mode" content="vertical-rl"/></metadata>',
    );
    expect(errorCode(buildEpub({ 'OEBPS/content.opf': opf }))).toBe('VERTICAL_LAYOUT');
  });

  it('detects vertical writing-mode in CSS, with or without prefixes', () => {
    for (const css of [
      'html { writing-mode: vertical-rl; }',
      'html { -epub-writing-mode: vertical-rl; }',
      'html{-webkit-writing-mode:vertical-rl}',
    ]) {
      expect(errorCode(buildEpub({ 'OEBPS/Styles/style.css': css }))).toBe('VERTICAL_LAYOUT');
    }
  });

  it('accepts horizontal writing-mode', () => {
    const css = 'html { writing-mode: horizontal-tb; }';
    expect(errorCode(buildEpub({ 'OEBPS/Styles/style.css': css }))).toBeNull();
  });
});

describe('parseEpub: NO_TEXT', () => {
  const scanned =
    '<html><body><img src="../Images/p1.jpg"/><img src="../Images/p2.jpg"/></body></html>';
  const opfWithImage = CONTENT_OPF.replace(
    '</manifest>',
    '<item id="p1" href="Images/p1.jpg" media-type="image/jpeg"/></manifest>',
  );

  it('detects an image-only book', () => {
    const epub = buildEpub({ 'OEBPS/content.opf': opfWithImage, 'OEBPS/Text/ch1.xhtml': scanned });
    expect(errorCode(epub)).toBe('NO_TEXT');
  });

  it('accepts a short book without images', () => {
    const epub = buildEpub({ 'OEBPS/Text/ch1.xhtml': '<html><body><p>Short.</p></body></html>' });
    expect(errorCode(epub)).toBeNull();
  });

  it('accepts a book with images and enough text', () => {
    expect(errorCode(buildEpub({ 'OEBPS/content.opf': opfWithImage }))).toBeNull();
  });
});
