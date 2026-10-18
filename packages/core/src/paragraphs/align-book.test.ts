import { describe, expect, it } from 'vitest';
import type { Section } from '../chapters/map.ts';
import type { Block } from '../extract/types.ts';
import { alignBook, toBlockPairs } from './align-book.ts';

function block(text: string): Block {
  return {
    kind: 'para',
    text,
    html: '',
    range: [0, 0],
    file: 'a.xhtml',
    ids: [],
    className: '',
    region: 'body',
  };
}

const section = (...texts: string[]): Section => ({
  title: '',
  depth: 0,
  blocks: texts.map(block),
});

const en = [
  section('Cover text only on one side.'),
  section('The first paragraph is fairly long.', 'Short.'),
];
const zh = [section('第一段比较长一些，长一些。', '短。')];

describe('alignBook', () => {
  it('skips groups with an empty side and keeps the group index', async () => {
    const groups = [
      { en: [0], zh: [] },
      { en: [1], zh: [0] },
    ];
    const result = await alignBook(groups, en, zh);
    expect(result.method).toBe('length');
    expect(result.groups.map((g) => g.index)).toEqual([1]);
    expect(result.groups[0]?.pairs).toEqual([
      { en: [0], zh: [0] },
      { en: [1], zh: [1] },
    ]);
  });
});

describe('toBlockPairs', () => {
  it('turns indices into blocks and swaps sides when the skeleton is Chinese', async () => {
    const aligned = await alignBook([{ en: [1], zh: [0] }], en, zh);
    const enSkeleton = toBlockPairs(aligned, 'en');
    expect(enSkeleton.map((p) => [p.group, p.skeleton[0]?.text, p.other[0]?.text])).toEqual([
      [0, 'The first paragraph is fairly long.', '第一段比较长一些，长一些。'],
      [0, 'Short.', '短。'],
    ]);
    const zhSkeleton = toBlockPairs(aligned, 'zh');
    expect(zhSkeleton[1]?.skeleton[0]).toBe(zh[0]?.blocks[1]);
    expect(zhSkeleton[1]?.other[0]).toBe(en[1]?.blocks[1]);
  });
});
