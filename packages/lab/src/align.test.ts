import { describe, expect, it } from 'vitest';
import { align, combinedCost, embeddingCost, lengthCost, normalCdf, type Pair } from './align.ts';

const simple = (pairs: Pair[]) => pairs.map((p) => `${p.en.join('+')}:${p.zh.join('+')}`);

describe('align', () => {
  it('pairs one to one when that is cheapest', () => {
    const cost = (en: number[], zh: number[]) =>
      en.length === 1 && zh.length === 1 && en[0] === zh[0] ? 0 : 1;
    expect(simple(align(3, 3, cost))).toEqual(['0:0', '1:1', '2:2']);
  });

  it('handles empty sides', () => {
    expect(simple(align(0, 2, () => 1))).toEqual([':0', ':1']);
    expect(align(0, 0, () => 1)).toEqual([]);
  });
});

describe('normalCdf', () => {
  it('matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe('lengthCost', () => {
  it('follows lengths, including a split into two', () => {
    // 中文大约是英文的一半长；英文第 1 段被拆成了中文第 1、2 段
    const en = [100, 200, 80];
    const zh = [50, 48, 52, 40];
    expect(simple(align(3, 4, lengthCost(en, zh)))).toEqual(['0:0', '1:1+2', '2:3']);
  });
});

describe('embeddingCost', () => {
  const v = (...xs: number[]) => {
    const a = new Float32Array(xs);
    const n = Math.hypot(...xs);
    return a.map((x) => x / n);
  };

  it('skips a Chinese paragraph that matches nothing', () => {
    const en = [v(1, 0, 0), v(0, 1, 0)];
    // 中文第 1 段是译注，和哪段英文都不像
    const zh = [v(1, 0.1, 0), v(0, 0, 1), v(0.1, 1, 0)];
    expect(simple(align(2, 3, embeddingCost(en, zh, { threshold: 0.5 })))).toEqual([
      '0:0',
      ':1',
      '1:2',
    ]);
  });

  it('merges two Chinese paragraphs that together match one English paragraph', () => {
    const en = [v(1, 1, 0), v(0, 0, 1)];
    const zh = [v(1, 0, 0), v(0, 1, 0), v(0, 0.1, 1)];
    expect(simple(align(2, 3, embeddingCost(en, zh, { threshold: 0.5 })))).toEqual([
      '0:0+1',
      '1:2',
    ]);
  });
});

describe('short merges', () => {
  const v = (...xs: number[]) => {
    const n = Math.hypot(...xs);
    return new Float32Array(xs.map((x) => x / n));
  };
  // 英文标题拆成两行（各像中文标题的一半），中文是一行
  const en = [v(1, 0.3, 0), v(0.3, 1, 0)];
  const zh = [v(1, 1, 0)];

  it('merges two short lines without a penalty', () => {
    const lengths = { en: [6, 8], zh: [9] };
    const cost = embeddingCost(en, zh, { threshold: 0.75, mergePenalty: 0.2, lengths });
    expect(simple(align(2, 1, cost))).toEqual(['0+1:0']);
  });

  it('still penalises merging long paragraphs', () => {
    const lengths = { en: [600, 800], zh: [900] };
    const cost = embeddingCost(en, zh, { threshold: 0.75, mergePenalty: 0.2, lengths });
    expect(simple(align(2, 1, cost))).not.toEqual(['0+1:0']);
  });
});

describe('combinedCost', () => {
  it('adds the two costs with a weight', () => {
    const cost = combinedCost(
      () => 2,
      () => -0.1,
      10,
    );
    expect(cost([0], [0])).toBeCloseTo(1);
  });
});
