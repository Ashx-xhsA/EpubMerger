// 正文范围的操作，以及主线程的预填和 core 的 pairFromAnchor 一样。
// 9 对书在 fixtures/ 里（不进 git），没有时那一组测试自动跳过

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chapterSections,
  extractBlocks,
  pairFromAnchor,
  parseEpub,
  splitChapters,
} from '@epubmerger/core';
import { describe, expect, it } from 'vitest';
import { prefillFromRange, setEnd, setStart, visibleRows } from './bodyRange.ts';
import { linksFromGroups } from './chapterTable.ts';
import { prepareChapters, type SectionInfo } from './pipeline.ts';

const FIXTURES = fileURLToPath(new URL('../../../fixtures', import.meta.url));

const pairs = ['pairs', 'holdout'].flatMap((set) => {
  const dir = join(FIXTURES, set);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((d) => existsSync(join(d, 'en.epub')) && existsSync(join(d, 'zh.epub')));
});

const range = { from: { en: 2, zh: 1 }, to: { en: 8, zh: 6 } };

describe('setStart / setEnd', () => {
  it('moves one side only', () => {
    expect(setStart(range, 'first', 3)).toEqual({ from: { en: 3, zh: 1 }, to: range.to });
    expect(setEnd(range, 'second', 5)).toEqual({ from: range.from, to: { en: 8, zh: 5 } });
  });

  it('drags the other end along instead of making the range backwards', () => {
    expect(setStart(range, 'first', 9)).toEqual({ from: { en: 9, zh: 1 }, to: { en: 9, zh: 6 } });
    expect(setEnd(range, 'second', 0)).toEqual({ from: { en: 2, zh: 0 }, to: { en: 8, zh: 0 } });
  });
});

describe('visibleRows', () => {
  const info = (empty = false): SectionInfo => ({
    title: '',
    depth: 0,
    chars: 100,
    preview: '',
    empty,
  });
  const sections = Array.from({ length: 12 }, () => info());

  it('folds the middle of the range, keeping a few sections next to each end', () => {
    expect(visibleRows(sections, 1, 10, { around: 2 })).toEqual([
      { kind: 'section', index: 0 },
      { kind: 'section', index: 1 },
      { kind: 'section', index: 2 },
      { kind: 'section', index: 3 },
      { kind: 'gap', indices: [4, 5, 6, 7] },
      { kind: 'section', index: 8 },
      { kind: 'section', index: 9 },
      { kind: 'section', index: 10 },
      { kind: 'section', index: 11 },
    ]);
  });

  it('does not fold a single section, or when expanded', () => {
    const all = sections.map((_, index) => ({ kind: 'section', index }));
    expect(visibleRows(sections, 1, 6, { around: 2 })).toEqual(all);
    expect(visibleRows(sections, 1, 10, { expanded: true })).toEqual(all);
  });

  it('hides sections without text unless asked', () => {
    const withEmpty = [info(), info(true), info()];
    expect(visibleRows(withEmpty, 0, 2)).toEqual([
      { kind: 'section', index: 0 },
      { kind: 'section', index: 2 },
    ]);
    expect(visibleRows(withEmpty, 0, 2, { showEmpty: true })).toHaveLength(3);
  });
});

describe.skipIf(pairs.length === 0)('prefillFromRange matches core on real books', () => {
  const sections = (bytes: Uint8Array) => {
    const parsed = parseEpub(bytes);
    if (!parsed.ok) throw new Error(parsed.error.code);
    const blocks = extractBlocks(parsed.book).blocks;
    return chapterSections(splitChapters(parsed.book, blocks), blocks);
  };

  it.each(pairs)('%s', (dir) => {
    const read = (name: string) => ({
      bytes: new Uint8Array(readFileSync(join(dir, name))),
      fileName: name,
    });
    const result = prepareChapters(read('en.epub'), read('zh.epub'));
    if (!result.ok) throw new Error(result.message);
    const { range: guessed } = result.chapters;
    const expected = pairFromAnchor(
      sections(read('en.epub').bytes),
      sections(read('zh.epub').bytes),
      guessed.from,
      guessed.to,
    );
    expect(prefillFromRange(result.chapters, guessed)).toEqual(linksFromGroups(expected));
  });
});
