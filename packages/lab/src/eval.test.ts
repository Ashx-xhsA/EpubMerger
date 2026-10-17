import { describe, expect, it } from 'vitest';
import { countBeads, precisionCounts, scores } from './eval.ts';

const bead = (en: number[], zh: number[]) => ({ en, zh });

describe('precisionCounts', () => {
  const gold = [bead([0], [0]), bead([1], [1, 2]), bead([2], []), bead([3], [3])];

  it('counts exact beads as strict and lax hits', () => {
    expect(precisionCounts(gold, [bead([0], [0]), bead([3], [3])])).toEqual({
      tpStrict: 2,
      fpStrict: 0,
      tpLax: 2,
      fpLax: 0,
    });
  });

  it('counts an overlapping bead as a lax hit only', () => {
    // 答案 英1 ↔ 中1+2，配成 英1 ↔ 中1：严格错，宽松对
    expect(precisionCounts(gold, [bead([1], [1])])).toEqual({
      tpStrict: 0,
      fpStrict: 1,
      tpLax: 1,
      fpLax: 0,
    });
  });

  it('scores null beads in precision', () => {
    // 英2 没有对应：说对了；中2 单独没有对应：说错了，宽松也错
    expect(precisionCounts(gold, [bead([2], []), bead([], [2])])).toEqual({
      tpStrict: 1,
      fpStrict: 1,
      tpLax: 1,
      fpLax: 1,
    });
  });

  it('ignores empty beads and duplicates', () => {
    expect(precisionCounts(gold, [bead([], []), bead([0], [0]), bead([0], [0])])).toEqual({
      tpStrict: 1,
      fpStrict: 0,
      tpLax: 1,
      fpLax: 0,
    });
  });

  it('does not depend on the order of indices', () => {
    expect(precisionCounts([bead([4, 5], [6])], [bead([5, 4], [6])]).tpStrict).toBe(1);
  });
});

describe('countBeads and scores', () => {
  it('leaves null beads out of recall', () => {
    const gold = [bead([0], [0]), bead([1], []), bead([2], [1])];
    const test = [bead([0], [0]), bead([1, 2], [1])];
    const c = countBeads(gold, test);
    // 准确率：1 对 1 错；召回率：答案里两边都有的 2 个单元，找到 1 个
    expect(c.precision).toEqual({ tpStrict: 1, fpStrict: 1, tpLax: 2, fpLax: 0 });
    expect(c.recall).toEqual({ tpStrict: 1, fpStrict: 1, tpLax: 2, fpLax: 0 });
    const s = scores(c);
    expect(s.strict).toEqual({ p: 0.5, r: 0.5, f: 0.5 });
    expect(s.lax.f).toBe(1);
  });

  it('gives zero instead of dividing by zero', () => {
    expect(scores(countBeads([], [])).strict).toEqual({ p: 0, r: 0, f: 0 });
  });
});
