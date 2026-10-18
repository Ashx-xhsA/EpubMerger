import { describe, expect, it } from 'vitest';
import type { Block } from '../extract/types.ts';
import {
  alignableBlocks,
  chapterSections,
  inBookOrder,
  prefillByOrder,
  validateChapterMap,
  withTitles,
} from './map.ts';

function block(
  text: string,
  region: Block['region'] = 'body',
  kind: Block['kind'] = 'para',
): Block {
  return { kind, text, html: '', range: [0, 0], file: 'a.xhtml', ids: [], className: '', region };
}

describe('alignableBlocks', () => {
  it('drops index, notes, images and empty blocks', () => {
    const blocks = [
      block('keep'),
      block('index', 'index'),
      block('note', 'notes'),
      block('', 'body', 'image'),
      block('  '),
      block('cover', 'cover'),
    ];
    expect(alignableBlocks(blocks).map((b) => b.text)).toEqual(['keep', 'cover']);
  });
});

describe('chapterSections', () => {
  it('keeps titles and depth and only the alignable blocks of each chapter', () => {
    const blocks = [block('cover'), block('one'), block('note', 'notes'), block('two')];
    const sections = chapterSections(
      {
        source: 'toc',
        tocStats: null,
        warnings: [],
        chapters: [
          { title: 'x', depth: 0, start: 0, end: 1, beforeToc: true },
          { title: 'One', depth: 0, start: 1, end: 3 },
          { title: '', depth: 1, start: 3, end: 4 },
        ],
      },
      blocks,
    );
    expect(sections.map((s) => [s.title, s.depth, s.blocks.map((b) => b.text)])).toEqual([
      ['（目录前）', 0, ['cover']],
      ['One', 0, ['one']],
      ['（空标题）', 1, ['two']],
    ]);
  });
});

describe('prefillByOrder', () => {
  it('pairs in order and leaves the extra sections unmerged', () => {
    expect(prefillByOrder(2, 3)).toEqual([
      { en: [0], zh: [0] },
      { en: [1], zh: [1] },
      { en: [], zh: [2] },
    ]);
  });

  it('puts empty sections in their own group', () => {
    const empty = (side: 'en' | 'zh', i: number) => side === 'zh' && i === 0;
    expect(prefillByOrder(2, 3, empty)).toEqual([
      { en: [], zh: [0] },
      { en: [0], zh: [1] },
      { en: [1], zh: [2] },
    ]);
  });
});

describe('validateChapterMap', () => {
  it('accepts many-to-one and unmerged groups', () => {
    const groups = [
      { en: [], zh: [0] },
      { en: [0, 1, 2], zh: [1] },
      { en: [3], zh: [] },
    ];
    expect(validateChapterMap(groups, 4, 2)).toEqual([]);
  });

  it('reports missing, duplicated, out-of-order and non-consecutive sections', () => {
    expect(validateChapterMap([{ en: [0], zh: [0] }], 2, 1)).toEqual(['en: missing 1']);
    expect(
      validateChapterMap(
        [
          { en: [0], zh: [0] },
          { en: [0], zh: [1] },
        ],
        1,
        2,
      ),
    ).toEqual(['en: duplicate or unknown 0']);
    expect(
      validateChapterMap(
        [
          { en: [1], zh: [0] },
          { en: [0], zh: [1] },
        ],
        2,
        2,
      ),
    ).toEqual(['en: sections are out of order']);
    expect(
      validateChapterMap(
        [
          { en: [0, 2], zh: [0] },
          { en: [1], zh: [] },
        ],
        3,
        1,
      ),
    ).toContain('group 0: en sections are not consecutive');
  });
});

describe('withTitles', () => {
  const sections = (...titles: string[]) =>
    titles.map((title) => ({ title, depth: 0, blocks: [block('text')] }));

  it('puts each side’s section titles on the group and keeps the section ids', () => {
    const groups = withTitles(
      [
        { en: [0, 1], zh: [0] },
        { en: [2], zh: [] },
      ],
      sections('Cover', 'One', 'Afterword'),
      sections('第一章'),
    );
    expect(groups).toEqual([
      { en: [0, 1], zh: [0], titles: { en: ['Cover', 'One'], zh: ['第一章'] } },
      { en: [2], zh: [], titles: { en: ['Afterword'], zh: [] } },
    ]);
  });

  it('replaces titles a group already had', () => {
    const [g] = withTitles(
      [{ en: [0], zh: [0], titles: { en: ['old'], zh: ['old'] } }],
      sections('New'),
      sections('新'),
    );
    expect(g?.titles).toEqual({ en: ['New'], zh: ['新'] });
  });
});

describe('inBookOrder', () => {
  it('puts lone sections that were appended at the end back where they belong', () => {
    const groups = [
      { en: [1], zh: [0] },
      { en: [3], zh: [2] },
      { en: [0], zh: [] },
      { en: [2], zh: [] },
      { en: [], zh: [1] },
      { en: [], zh: [3] },
    ];
    const ordered = inBookOrder(groups);
    expect(ordered).toEqual([
      { en: [0], zh: [] },
      { en: [1], zh: [0] },
      { en: [2], zh: [] },
      { en: [], zh: [1] },
      { en: [3], zh: [2] },
      { en: [], zh: [3] },
    ]);
    expect(validateChapterMap(ordered, 4, 4)).toEqual([]);
  });
});
