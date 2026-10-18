import type { Block } from '@epubmerger/core';
import { describe, expect, it } from 'vitest';
import { partners, scoreJudged, type GroupResult } from './paragraphs.ts';

const block = (text: string): Block => ({
  kind: 'para',
  text,
  html: '',
  range: [0, 0],
  file: 'a.xhtml',
  ids: [],
  className: '',
  region: 'body',
});

describe('partners', () => {
  const pairs = [
    { en: [0], zh: [0, 1] },
    { en: [], zh: [2] },
    { en: [1, 2], zh: [3] },
  ];

  it('lists what each paragraph was paired with, empty when skipped', () => {
    expect(partners(pairs, 'zh', 4)).toEqual(['0', '0', '', '1+2']);
    expect(partners(pairs, 'en', 3)).toEqual(['0+1', '3', '3']);
  });
});

describe('scoreJudged', () => {
  const group = {
    index: 3,
    en: [block('PART 2'), block('THE OTHER'), block('“Hello,” he said.')],
    zh: [block('第二部分 那个人'), block('“你好，”他说。')],
    byLength: [
      { en: [0, 1], zh: [0] },
      { en: [2], zh: [1] },
    ],
  } as unknown as GroupResult;

  it('compares by opening text, ignoring quotes and punctuation', () => {
    const cases = [
      { group: 3, zh: '第二部分', en: ['PART 2', 'THE OTHER'] },
      { group: 3, zh: '"你好', en: ['Hello he said'] },
      { group: 3, zh: '不存在', en: [] },
    ];
    const s = scoreJudged([group], cases, (g) => g.byLength);
    expect(s).toMatchObject({ correct: 2, total: 2, notFound: ['[3] 不存在'], wrong: [] });
  });

  it('counts a wrong partner as wrong', () => {
    const cases = [{ group: 3, zh: '第二部分', en: ['PART 2'] }];
    expect(scoreJudged([group], cases, (g) => g.byLength).correct).toBe(0);
  });
});
