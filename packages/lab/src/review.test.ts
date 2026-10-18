import type { Block } from '@epubmerger/core';
import { describe, expect, it } from 'vitest';
import type { GroupResult } from './paragraphs.ts';
import { answerIds, assignVerdicts, matches, pickSample, rows } from './review.ts';

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

describe('matches', () => {
  it('matches by opening, ignoring punctuation', () => {
    expect(matches('1个火把（我一直没用）', '1个火把')).toBe(true);
    expect(matches('“没有，”我说', '"没有"我说')).toBe(true);
  });

  it('requires the whole paragraph for very short keys', () => {
    expect(matches('预言家', '预言家')).toBe(true);
    expect(matches('预言家说了很多', '预言家')).toBe(false);
  });
});

describe('answerIds', () => {
  const blocks = ['PART 3', 'THE PROPHET', 'The Prophet', 'x', 'DEAR 16', 'y', 'DEAR 16'].map(
    block,
  );

  it('prefers an exact-case match, then the one nearest to the row', () => {
    expect(answerIds(['The Prophet'], blocks, 0)).toBe('2');
    expect(answerIds(['DEAR 16'], blocks, 6)).toBe('6');
    expect(answerIds(['DEAR 16'], blocks, 3)).toBe('4');
    expect(answerIds([], blocks, 0)).toBe('无');
    expect(answerIds(['missing'], blocks, 0)).toBe('?');
  });
});

describe('assignVerdicts', () => {
  // 中文里"皮拉内西"出现两次（信末签名），三种方法都一对一
  const zh = ['皮拉内西', '正文一', '皮拉内西'].map(block);
  const en = ['PIRANESI', 'Body one', 'PIRANESI'].map(block);
  const pairs = [0, 1, 2].map((i) => ({ en: [i], zh: [i] }));
  const g = {
    index: 5,
    en,
    zh,
    byLength: pairs,
    byMeaning: pairs,
    byCombined: pairs,
  } as unknown as GroupResult;

  it('gives each verdict to one row, the one nearest to at', () => {
    const assigned = assignVerdicts(g, rows(g), [{ group: 5, zh: '皮拉内西', ok: false, at: 2 }]);
    expect([...assigned.keys()]).toEqual([2]);
  });

  it('uses the first matching row when there is no at', () => {
    const assigned = assignVerdicts(g, rows(g), [
      { group: 5, zh: '皮拉内西', ok: true },
      { group: 5, zh: '皮拉内西', ok: false },
    ]);
    expect([...assigned.keys()].sort()).toEqual([0, 2]);
  });
});

describe('pickSample', () => {
  const rowsOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      key: `1|zh:${i}:段落${i}`,
      yellow: i % 10 === 0,
      init: i === 5 ? {} : null,
    }));

  it('picks only white, unjudged rows, the same ones every time', () => {
    const picked = pickSample(rowsOf(200), 20);
    expect(picked).toHaveLength(20);
    expect(picked.every((i) => i % 10 !== 0 && i !== 5)).toBe(true);
    expect(pickSample(rowsOf(200), 20)).toEqual(picked);
  });

  it('takes everything when there are fewer rows than the sample size', () => {
    expect(pickSample(rowsOf(8), 50)).toEqual([1, 2, 3, 4, 6, 7]);
  });
});
