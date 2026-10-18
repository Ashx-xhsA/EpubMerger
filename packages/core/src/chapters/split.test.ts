import { describe, expect, it } from 'vitest';
import { parseEpub } from '../epub/parse.ts';
import { buildEpub } from '../epub/test-helpers.ts';
import type { Book, TocEntry } from '../epub/types.ts';
import { extractBlocks } from '../extract/extract.ts';
import type { Block } from '../extract/types.ts';
import { splitAt, splitBySpine, splitChapters } from './split.ts';

function block(
  file: string,
  text: string,
  kind: Block['kind'] = 'para',
  ids: string[] = [],
): Block {
  return { kind, text, html: '', range: [0, 0], file, ids, className: '', region: 'body' };
}

function book(files: string[], toc: TocEntry[]): Book {
  return {
    version: '3.0',
    metadata: { title: '', creators: [], languages: [], identifier: null, coverId: null },
    opfPath: 'content.opf',
    manifest: new Map(),
    spine: files.map((href) => ({ idref: href, href, linear: true })),
    toc,
    tocSource: toc.length > 0 ? 'nav' : 'none',
    files: [],
    readText: () => null,
    readBytes: () => null,
  };
}

const entry = (title: string, href: string, fragment: string | null = null): TocEntry => ({
  title,
  href,
  fragment,
  children: [],
});

const ranges = (chapters: { start: number; end: number }[]) =>
  chapters.map((c) => [c.start, c.end]);

describe('splitAt', () => {
  it('cuts at each start and puts what comes before the first entry in its own chapter', () => {
    const chapters = splitAt(6, [
      { title: 'A', depth: 0, start: 1 },
      { title: 'B', depth: 0, start: 3 },
      { title: 'C', depth: 0, start: 4 },
    ]);
    expect(chapters.map((c) => [c.title, c.start, c.end, c.beforeToc ?? false])).toEqual([
      ['', 0, 1, true],
      ['A', 1, 3, false],
      ['B', 3, 4, false],
      ['C', 4, 6, false],
    ]);
  });

  it('gives a parent that starts where its first child starts an empty chapter', () => {
    const chapters = splitAt(6, [
      { title: 'Part 1', depth: 0, start: 1 },
      { title: 'Ch 1', depth: 1, start: 1 },
      { title: 'Ch 2', depth: 1, start: 3 },
    ]);
    expect(ranges(chapters.slice(1))).toEqual([
      [1, 1],
      [1, 3],
      [3, 6],
    ]);
  });

  it('never overlaps when an entry points backwards', () => {
    const chapters = splitAt(6, [
      { title: 'A', depth: 0, start: 0 },
      { title: 'C', depth: 0, start: 4 },
      { title: 'B', depth: 0, start: 3 },
    ]);
    expect(ranges(chapters)).toEqual([
      [0, 4],
      [4, 4],
      [4, 6],
    ]);
  });
});

describe('splitBySpine', () => {
  it('makes one chapter per file, titled by its first heading or else its file name', () => {
    const blocks = [
      block('Text/a.xhtml', 'One', 'heading'),
      block('Text/a.xhtml', 'x'),
      block('Text/b.xhtml', 'y'),
    ];
    expect(splitBySpine(blocks).map((c) => [c.title, c.start, c.end])).toEqual([
      ['One', 0, 2],
      ['b.xhtml', 2, 3],
    ]);
  });
});

describe('splitChapters', () => {
  const files = ['a.xhtml', 'b.xhtml', 'c.xhtml'];
  const blocks = files.flatMap((f) => [
    block(f, `${f} start`, 'para', [`${f}-top`]),
    block(f, 'x'.repeat(100)),
  ]);

  it('uses a reliable toc as is', () => {
    const result = splitChapters(
      book(
        files,
        files.map((f) => entry(f, f)),
      ),
      blocks,
    );
    expect(result.source).toBe('toc');
    expect(result.warnings).toEqual([]);
    expect(ranges(result.chapters)).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ]);
  });

  it('falls back to files with TOC_MISSING when there is no toc', () => {
    const result = splitChapters(book(files, []), blocks);
    expect(result.source).toBe('spine');
    expect(result.warnings.map((w) => w.code)).toEqual(['TOC_MISSING']);
    expect(result.tocStats).toBeNull();
    expect(result.chapters).toHaveLength(3);
  });

  it('treats a toc with a single entry as missing', () => {
    const result = splitChapters(book(files, [entry('All', 'a.xhtml')]), blocks);
    expect(result.warnings.map((w) => w.code)).toEqual(['TOC_MISSING']);
    expect(result.source).toBe('spine');
  });

  it('rejects a toc whose entries mostly point outside the spine', () => {
    const toc = [
      entry('A', 'a.xhtml'),
      entry('B', 'b.xhtml'),
      entry('X', 'gone1.xhtml'),
      entry('Y', 'gone2.xhtml'),
      entry('Z', 'gone3.xhtml'),
    ];
    const result = splitChapters(book(files, toc), blocks);
    expect(result.warnings.map((w) => w.code)).toEqual(['TOC_UNRELIABLE']);
    expect(result.warnings[0]!.message).toContain('outside the spine');
    expect(result.tocStats!.unresolvedShare).toBeCloseTo(0.6);
  });

  it('rejects a toc that only covers the end of the book', () => {
    const result = splitChapters(
      book(files, [entry('C', 'c.xhtml'), entry('C2', 'c.xhtml', 'nope')]),
      blocks,
    );
    expect(result.warnings[0]!.message).toContain('before the first entry');
    expect(result.source).toBe('spine');
  });

  it('rejects a toc where one entry holds most of the book and files would split it further', () => {
    const many = ['a.xhtml', 'b.xhtml', 'c.xhtml', 'd.xhtml', 'e.xhtml'];
    const bs = many.flatMap((f) => [block(f, 'x'.repeat(100))]);
    const result = splitChapters(
      book(many, [entry('Cover', 'a.xhtml'), entry('Text', 'b.xhtml')]),
      bs,
    );
    expect(result.warnings[0]!.message).toContain('one entry holds 80%');
    expect(result.chapters).toHaveLength(5);
  });

  it('keeps a big chapter when files would not split the book any further', () => {
    const two = ['a.xhtml', 'b.xhtml'];
    const bs = [block('a.xhtml', 'x'.repeat(10)), block('b.xhtml', 'x'.repeat(100))];
    const result = splitChapters(book(two, [entry('A', 'a.xhtml'), entry('B', 'b.xhtml')]), bs);
    expect(result.source).toBe('toc');
  });

  it('makes the whole book one chapter when it is a single file without a usable toc', () => {
    const parsed = parseEpub(buildEpub());
    if (!parsed.ok) throw new Error(parsed.error.code);
    const { blocks: bs } = extractBlocks(parsed.book);
    const result = splitChapters(parsed.book, bs);
    expect(result.source).toBe('whole');
    expect(result.warnings.map((w) => w.code)).toEqual(['TOC_MISSING']);
    expect(ranges(result.chapters)).toEqual([[0, bs.length]]);
  });
});
