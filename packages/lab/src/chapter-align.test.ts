import type { Block } from '@epubmerger/core';
import { describe, expect, it } from 'vitest';
import { describePrediction, scoreChapters } from './chapter-align.ts';
import type { Section } from './chapters.ts';

const block: Block = {
  kind: 'para',
  text: 'x',
  html: '',
  file: 'a',
  ids: [],
  className: '',
  region: 'body',
};
const section = (title: string, empty = false): Section => ({
  title,
  depth: 0,
  blocks: empty ? [] : [block],
});

describe('scoreChapters', () => {
  // 英文：扉页（空）、版权、第 1 章、第 2 章；中文：译者序、第 1 章、第 2 章
  const en = [section('Title', true), section('Copyright'), section('Ch 1'), section('Ch 2')];
  const zh = [section('译者序'), section('第一章'), section('第二章')];
  const truth = [
    { en: [0, 1], zh: [] },
    { en: [], zh: [0] },
    { en: [2], zh: [1] },
    { en: [3], zh: [2] },
  ];

  it('gives full marks to the truth itself', () => {
    const s = scoreChapters(truth, truth, en, zh);
    expect(s).toMatchObject({
      paired: { correct: 2, total: 2 },
      unmerged: { correct: 2, total: 2 },
      toFix: 0,
    });
  });

  it('counts a shifted pairing as wrong rows to fix', () => {
    // 按顺序预填：版权对译者序，第 1 章对第 1 章，第 2 章对第 2 章
    const order = [
      { en: [0], zh: [] },
      { en: [1], zh: [0] },
      { en: [2], zh: [1] },
      { en: [3], zh: [2] },
    ];
    const s = scoreChapters(truth, order, en, zh);
    expect(s.paired).toEqual({ correct: 2, total: 2 });
    expect(s.unmerged).toEqual({ correct: 0, total: 2 });
    expect(s.toFix).toBe(2);
    expect(s.perGroup).toEqual([false, false, true, true]);
    expect(describePrediction(truth[1]!, order)).toBe('EN 1 ↔ ZH 0');
  });

  it('requires the exact group for many-to-one', () => {
    const t = [{ en: [2, 3], zh: [1] }];
    expect(
      scoreChapters(
        t,
        [
          { en: [2], zh: [1] },
          { en: [3], zh: [] },
        ],
        en,
        zh,
      ).paired.correct,
    ).toBe(0);
    expect(scoreChapters(t, [{ en: [2, 3], zh: [1] }], en, zh).paired.correct).toBe(1);
  });
});
