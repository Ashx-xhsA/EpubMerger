import { describe, expect, it } from 'vitest';
import { parseOpf, readContainer } from './opf.ts';

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

// ePub 2 写法：带 dc: / opf: 前缀
const OPF2 = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>地球生命小史</dc:title>
    <dc:creator opf:role="aut">亨利·吉</dc:creator>
    <dc:identifier opf:scheme="calibre">a5d7525a</dc:identifier>
    <dc:identifier id="uid">9787521753806</dc:identifier>
    <dc:language>zh</dc:language>
    <meta name="primary-writing-mode" content="horizontal-lr"/>
  </metadata>
  <manifest>
    <item id="cover" href="Text/cover_page.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="Text/My%20Chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover" linear="no"/>
    <itemref idref="ch1"/>
  </spine>
</package>`;

// ePub 3 写法：没有前缀的 metadata，nav 用 properties 标出
const OPF3 = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata>
    <title xmlns="http://purl.org/dc/elements/1.1/">Piranesi</title>
    <creator xmlns="http://purl.org/dc/elements/1.1/">Susanna Clarke</creator>
    <language xmlns="http://purl.org/dc/elements/1.1/">en</language>
    <meta property="rendition:layout">reflowable</meta>
  </metadata>
  <manifest>
    <item id="nav" href="xhtml/toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="ch1" href="xhtml/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine page-progression-direction="ltr">
    <itemref idref="ch1"/>
  </spine>
</package>`;

function parseOk(text: string, path = 'OEBPS/content.opf') {
  const result = parseOpf(text, path);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

describe('readContainer', () => {
  it('finds the OPF path', () => {
    expect(readContainer(CONTAINER)).toBe('OEBPS/content.opf');
  });

  it('returns null when there is no rootfile', () => {
    expect(readContainer('<container><rootfiles/></container>')).toBeNull();
  });
});

describe('parseOpf: ePub 2', () => {
  const { opf, warnings } = parseOk(OPF2);

  it('reads metadata with prefixes', () => {
    expect(opf.version).toBe('2.0');
    expect(opf.metadata).toEqual({
      title: '地球生命小史',
      creators: ['亨利·吉'],
      languages: ['zh'],
      identifier: '9787521753806', // unique-identifier 指向的那个，不是第一个
      coverId: null,
    });
    expect(warnings).toEqual([]);
  });

  it('resolves manifest paths relative to the OPF folder', () => {
    expect(opf.manifest.get('ch1')).toEqual({
      id: 'ch1',
      href: 'OEBPS/Text/My Chapter.xhtml',
      mediaType: 'application/xhtml+xml',
      properties: [],
    });
  });

  it('reads the spine in order with linear flags', () => {
    expect(opf.spine).toEqual([
      { idref: 'cover', href: 'OEBPS/Text/cover_page.xhtml', linear: false },
      { idref: 'ch1', href: 'OEBPS/Text/My Chapter.xhtml', linear: true },
    ]);
  });

  it('reads the Kindle writing mode', () => {
    expect(opf.writingMode).toBe('horizontal-lr');
  });

  it('finds the NCX through spine toc', () => {
    expect(opf.ncxPath).toBe('OEBPS/toc.ncx');
    expect(opf.navPath).toBeNull();
  });
});

describe('parseOpf: ePub 3', () => {
  const { opf } = parseOk(OPF3, 'OPS/package.opf');

  it('reads metadata without prefixes', () => {
    expect(opf.metadata.title).toBe('Piranesi');
    expect(opf.metadata.creators).toEqual(['Susanna Clarke']);
    expect(opf.metadata.identifier).toBeNull();
  });

  it('reads manifest properties and finds nav', () => {
    expect(opf.manifest.get('img')?.properties).toEqual(['cover-image']);
    expect(opf.navPath).toBe('OPS/xhtml/toc.xhtml');
    expect(opf.ncxPath).toBeNull();
  });

  it('reads layout info', () => {
    expect(opf.fixedLayout).toBe(false);
    expect(opf.pageProgression).toBe('ltr');
    expect(opf.writingMode).toBeNull();
  });
});

describe('parseOpf: layout flags', () => {
  it('detects ePub 3 fixed layout', () => {
    const text = OPF3.replace('>reflowable<', '>pre-paginated<');
    expect(parseOk(text).opf.fixedLayout).toBe(true);
  });

  it('detects Kindle fixed layout', () => {
    const text = OPF2.replace(
      '</metadata>',
      '<meta name="fixed-layout" content="true"/></metadata>',
    );
    expect(parseOk(text).opf.fixedLayout).toBe(true);
  });

  it('reads rtl page progression', () => {
    const text = OPF2.replace(
      '<spine toc="ncx">',
      '<spine toc="ncx" page-progression-direction="rtl">',
    );
    expect(parseOk(text).opf.pageProgression).toBe('rtl');
  });
});

describe('parseOpf: problems', () => {
  it('skips spine entries missing from the manifest, with a warning', () => {
    const text = OPF2.replace(
      '<itemref idref="ch1"/>',
      '<itemref idref="ch1"/><itemref idref="ghost"/>',
    );
    const { opf, warnings } = parseOk(text);
    expect(opf.spine.map((s) => s.idref)).toEqual(['cover', 'ch1']);
    expect(warnings.map((w) => w.code)).toEqual(['SPINE_ITEMS_SKIPPED']);
  });

  it('skips external and broken manifest items, with a warning', () => {
    const text = OPF2.replace(
      '</manifest>',
      '<item id="web" href="https://example.com/x.css" media-type="text/css"/><item href="no-id.css"/></manifest>',
    );
    const { opf, warnings } = parseOk(text);
    expect(opf.manifest.has('web')).toBe(false);
    expect(warnings.map((w) => w.code)).toEqual(['MANIFEST_ITEMS_SKIPPED']);
  });

  it('warns when title or language is missing', () => {
    const text = OPF2.replace(/<dc:title>.*<\/dc:title>/, '').replace(
      /<dc:language>.*<\/dc:language>/,
      '',
    );
    expect(parseOk(text).warnings.map((w) => w.code)).toEqual([
      'MISSING_TITLE',
      'MISSING_LANGUAGE',
    ]);
  });

  it('is CORRUPTED without <package>', () => {
    expect(parseOpf('<html/>', 'a.opf')).toMatchObject({ ok: false, error: { code: 'CORRUPTED' } });
  });

  it('is CORRUPTED when the spine is empty', () => {
    const text = OPF2.replace(/<spine[\s\S]*<\/spine>/, '<spine toc="ncx"></spine>');
    expect(parseOpf(text, 'a.opf')).toMatchObject({ ok: false, error: { code: 'CORRUPTED' } });
  });

  it('is CORRUPTED when no spine entry is in the manifest', () => {
    const text = OPF2.replace(/idref="(cover|ch1)"/g, 'idref="ghost"');
    expect(parseOpf(text, 'a.opf')).toMatchObject({ ok: false, error: { code: 'CORRUPTED' } });
  });
});
