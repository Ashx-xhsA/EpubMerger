import type { Block, Pair } from '@epubmerger/core';
import { describe, expect, it } from 'vitest';
import { buildGold, goldGroup } from './gold.ts';
import type { GroupResult } from './paragraphs.ts';

const block = (text: string): Block => ({
  kind: 'para',
  text,
  html: '',
  file: 'a.xhtml',
  ids: [],
  className: '',
  region: 'body',
});

/** 一组：三种方法都配成 pairs（这样没有黄色行，只看判断） */
function group(en: string[], zh: string[], pairs: Pair[]): GroupResult {
  return {
    index: 3,
    enTitle: 'Chapter',
    zhTitle: '第一章',
    en: en.map(block),
    zh: zh.map(block),
    byLength: pairs,
    byMeaning: pairs,
    byCombined: pairs,
  } as unknown as GroupResult;
}

const beads = (r: ReturnType<typeof goldGroup>) => r.group.beads.map(({ en, zh }) => ({ en, zh }));

describe('goldGroup', () => {
  const en = ['Alpha one', 'Beta two', 'Gamma three'];
  const zh = ['甲一甲一', '乙二乙二', '丙三丙三'];
  const diagonal = [0, 1, 2].map((i) => ({ en: [i], zh: [i] }));

  it('keeps unjudged and correct rows as they are', () => {
    const r = goldGroup(group(en, zh, diagonal), [{ group: 3, zh: '乙二乙二', ok: true }], []);
    expect(beads(r)).toEqual(diagonal);
    expect(r.problems).toEqual([]);
    expect(r.group.beads[0]!.enHead).toEqual(['Alpha one']);
  });

  it('replaces a wrong row with its answer and reports what is left over', () => {
    // 合并法：A↔甲、B↔乙、C↔丙；答案：甲 ↔ A+B，乙没有对应
    const verdicts = [
      { group: 3, zh: '甲一甲一', ok: false, answer: ['Alpha', 'Beta'] },
      { group: 3, zh: '乙二乙二', ok: false, answer: [] },
    ];
    const r = goldGroup(group(en, zh, diagonal), verdicts, []);
    expect(beads(r)).toEqual([
      { en: [0, 1], zh: [0] },
      { en: [], zh: [1] },
      { en: [2], zh: [2] },
    ]);
    expect(r.problems).toEqual([]);
  });

  it('answers English-only rows with Chinese paragraphs', () => {
    const pairs = [
      { en: [0], zh: [0] },
      { en: [1], zh: [] },
      { en: [2], zh: [1, 2] },
    ];
    const verdicts = [
      { group: 3, en: 'Beta two', ok: false, answer: ['乙二'] },
      { group: 3, zh: '乙二乙二', ok: false, answer: [] },
    ];
    const r = goldGroup(group(en, zh, pairs), verdicts, []);
    // 两条答案都点名了 乙，要人来定
    expect(r.problems.some((p) => p.includes('中 #1') && p.includes('出现 2 次'))).toBe(true);
  });

  it('reports orphans, missing answers, unsure and unmatched verdicts', () => {
    const verdicts = [
      { group: 3, zh: '甲一甲一', ok: false, answer: ['Nothing like this'] },
      { group: 3, zh: '乙二乙二', ok: null },
      { group: 3, zh: '没有这段', ok: true },
    ];
    const r = goldGroup(group(en, zh, diagonal), verdicts, []);
    expect(r.problems).toHaveLength(4);
    expect(r.problems.join('\n')).toMatch(/答案找不到段落「Nothing like this」/);
    expect(r.problems.join('\n')).toMatch(/不确定/);
    expect(r.problems.join('\n')).toMatch(/判断找不到对应的行/);
    expect(r.problems.join('\n')).toMatch(/落单：英 #0/);
  });

  it('applies fixes by taking their paragraphs out of other beads', () => {
    const verdicts = [{ group: 3, zh: '甲一甲一', ok: false, answer: ['Alpha', 'Beta'] }];
    // 答案说 甲 ↔ A+B，B 从 乙↔B 里拿掉，乙 剩下单独一个，要人看；修正：乙 没有对应
    const before = goldGroup(group(en, zh, diagonal), verdicts, []);
    expect(before.problems).toEqual([
      '组 3（第一章）：段落被答案拿走，剩下：（无） ↔ 中 #1「乙二乙二」',
    ]);
    const fix = { group: 3, en: [], zh: ['乙二'] };
    const after = goldGroup(group(en, zh, diagonal), verdicts, [fix]);
    expect(after.problems).toEqual([]);
    expect(beads(after)).toEqual([
      { en: [0, 1], zh: [0] },
      { en: [2], zh: [2] },
      { en: [], zh: [1] },
    ]);
  });
});

describe('buildGold', () => {
  it('reports verdicts for groups that are not aligned', () => {
    const g = group(['A text'], ['甲文字'], [{ en: [0], zh: [0] }]);
    const r = buildGold([g], [{ group: 9, zh: '甲文字', ok: true }], []);
    expect(r.problems).toEqual(['组 9 不在配对的组里（判断或修正对不上）']);
  });
});
