import { describe, expect, it } from 'vitest';
import type { OpfInfo } from './opf.ts';
import { readToc } from './toc.ts';
import type { TocEntry } from './types.ts';
import type { ZipArchive } from './zip.ts';

/** 用"路径 → 文字"造一个假的解压结果 */
function fakeArchive(files: Record<string, string>): ZipArchive {
  const encoded = new Map(Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)]));
  return { paths: [...encoded.keys()], read: (path) => encoded.get(path) ?? null };
}

function fakeOpf(navPath: string | null, ncxPath: string | null): OpfInfo {
  return {
    version: '3.0',
    metadata: { title: '', creators: [], languages: [], identifier: null, coverId: null },
    manifest: new Map(),
    spine: [],
    navPath,
    ncxPath,
    fixedLayout: false,
    pageProgression: null,
    writingMode: null,
  };
}

/** 只看标题和层级，方便比较 */
function titles(entries: TocEntry[]): unknown[] {
  return entries.map((e) => (e.children.length === 0 ? e.title : [e.title, titles(e.children)]));
}

const CHAPTERS = {
  'OEBPS/xhtml/part1.xhtml': '<html/>',
  'OEBPS/xhtml/ch1.xhtml': '<html/>',
  'OEBPS/xhtml/ch2.xhtml': '<html/>',
};

// 照着《皮拉内西》英文版：OPF 在 OEBPS/，nav 在 OEBPS/xhtml/
const NAV = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="toc">
    <h1>Contents</h1>
    <ol>
      <li><a href="part1.xhtml">Part 1: <i>Piranesi</i></a>
        <ol>
          <li><a href="ch1.xhtml">Chapter 1</a></li>
          <li><a href="ch1.xhtml#sec2">Chapter 1, part 2</a></li>
        </ol>
      </li>
      <li><span>Part 2</span>
        <ol><li><a href="ch2.xhtml">Chapter 2</a></li></ol>
      </li>
      <li><span>Empty heading</span></li>
      <li><a href="https://example.com/">Publisher website</a></li>
    </ol>
  </nav>
  <nav epub:type="page-list"><ol><li><a href="ch1.xhtml#p1">1</a></li></ol></nav>
</body>
</html>`;

const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n2" playOrder="10">
      <navLabel><text>Part 1</text></navLabel>
      <content src="xhtml/part1.xhtml"/>
      <navPoint id="n3" playOrder="7">
        <navLabel><text>Chapter 1</text></navLabel>
        <content src="xhtml/ch1.xhtml#a1"/>
      </navPoint>
    </navPoint>
    <navPoint id="n1" playOrder="1">
      <navLabel><text>  Chapter
        2 </text></navLabel>
      <content src="xhtml/ch2.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;

describe('readToc: nav', () => {
  const archive = fakeArchive({ ...CHAPTERS, 'OEBPS/xhtml/toc.xhtml': NAV });
  const result = readToc(archive, fakeOpf('OEBPS/xhtml/toc.xhtml', null), 'OEBPS/content.opf');

  it('reads the nested toc nav and skips page-list', () => {
    expect(result.source).toBe('nav');
    expect(titles(result.toc)).toEqual([
      ['Part 1: Piranesi', ['Chapter 1', 'Chapter 1, part 2']],
      ['Part 2', ['Chapter 2']],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('resolves links relative to the nav file and keeps anchors', () => {
    const [part1] = result.toc;
    expect(part1?.href).toBe('OEBPS/xhtml/part1.xhtml');
    expect(part1?.children[1]).toMatchObject({ href: 'OEBPS/xhtml/ch1.xhtml', fragment: 'sec2' });
  });

  it('gives a heading without a link the position of its first child', () => {
    expect(result.toc[1]).toMatchObject({ href: 'OEBPS/xhtml/ch2.xhtml', fragment: null });
  });

  it('uses the first <nav> when none is marked toc', () => {
    const plain = NAV.replace('epub:type="toc"', '').replace(
      /<nav epub:type="page-list">.*<\/nav>/,
      '',
    );
    const r = readToc(
      fakeArchive({ ...CHAPTERS, 'OEBPS/xhtml/toc.xhtml': plain }),
      fakeOpf('OEBPS/xhtml/toc.xhtml', null),
      'OEBPS/content.opf',
    );
    expect(r.toc).toHaveLength(2);
  });
});

describe('readToc: NCX', () => {
  const archive = fakeArchive({ ...CHAPTERS, 'OEBPS/toc.ncx': NCX });
  const result = readToc(archive, fakeOpf(null, 'OEBPS/toc.ncx'), 'OEBPS/content.opf');

  it('reads nested navPoints in document order, ignoring playOrder', () => {
    expect(result.source).toBe('ncx');
    expect(titles(result.toc)).toEqual([['Part 1', ['Chapter 1']], 'Chapter 2']);
    expect(result.warnings).toEqual([]);
  });

  it('keeps anchors', () => {
    expect(result.toc[0]?.children[0]).toMatchObject({
      href: 'OEBPS/xhtml/ch1.xhtml',
      fragment: 'a1',
    });
  });
});

describe('readToc: choosing and fallbacks', () => {
  it('prefers nav when both exist', () => {
    const archive = fakeArchive({
      ...CHAPTERS,
      'OEBPS/xhtml/toc.xhtml': NAV,
      'OEBPS/toc.ncx': NCX,
    });
    const r = readToc(
      archive,
      fakeOpf('OEBPS/xhtml/toc.xhtml', 'OEBPS/toc.ncx'),
      'OEBPS/content.opf',
    );
    expect(r.source).toBe('nav');
  });

  it('falls back to NCX when nav is empty, with a warning', () => {
    const archive = fakeArchive({
      ...CHAPTERS,
      'OEBPS/xhtml/toc.xhtml': '<html><body><nav epub:type="toc"></nav></body></html>',
      'OEBPS/toc.ncx': NCX,
    });
    const r = readToc(
      archive,
      fakeOpf('OEBPS/xhtml/toc.xhtml', 'OEBPS/toc.ncx'),
      'OEBPS/content.opf',
    );
    expect(r.source).toBe('ncx');
    expect(r.warnings.map((w) => w.code)).toEqual(['NAV_FALLBACK_TO_NCX']);
  });

  it('returns an empty toc when there is none (not an error)', () => {
    const r = readToc(fakeArchive(CHAPTERS), fakeOpf(null, null), 'OEBPS/content.opf');
    expect(r).toMatchObject({ toc: [], source: 'none' });
    expect(r.warnings.map((w) => w.code)).toEqual(['NO_TOC']);
  });

  it('retries links relative to the OPF folder when the standard path is missing', () => {
    // nav 在 OEBPS/xhtml/，但链接错写成相对 OPF：xhtml/ch1.xhtml
    const nav =
      '<nav epub:type="toc"><ol><li><a href="xhtml/ch1.xhtml">Chapter 1</a></li></ol></nav>';
    const r = readToc(
      fakeArchive({ ...CHAPTERS, 'OEBPS/xhtml/toc.xhtml': nav }),
      fakeOpf('OEBPS/xhtml/toc.xhtml', null),
      'OEBPS/content.opf',
    );
    expect(r.toc[0]?.href).toBe('OEBPS/xhtml/ch1.xhtml');
    expect(r.warnings).toEqual([]);
  });

  it('keeps broken links but warns about them', () => {
    const nav =
      '<nav epub:type="toc"><ol><li><a href="ch1.xhtml">One</a></li><li><a href="gone.xhtml">Gone</a></li></ol></nav>';
    const r = readToc(
      fakeArchive({ ...CHAPTERS, 'OEBPS/xhtml/toc.xhtml': nav }),
      fakeOpf('OEBPS/xhtml/toc.xhtml', null),
      'OEBPS/content.opf',
    );
    expect(titles(r.toc)).toEqual(['One', 'Gone']);
    expect(r.warnings.map((w) => w.code)).toEqual(['TOC_BROKEN_LINKS']);
  });
});
