import { describe, expect, it } from 'vitest';
import { galeChurch, match, PENALTY } from './gale-church.ts';

describe('PENALTY', () => {
  it('matches the priors in the paper, relative to 1:1', () => {
    const penalty = (p: number) => -100 * Math.log(p / 0.89);
    expect(Math.round(penalty(0.0099))).toBe(PENALTY.skip);
    expect(Math.round(penalty(0.089))).toBe(PENALTY.merge);
    // 2:2 算出来是 439.3，C 代码写的是 440
    expect(Math.abs(penalty(0.011) - PENALTY.double)).toBeLessThan(1);
  });
});

describe('match', () => {
  it('costs nothing when lengths agree with c', () => {
    expect(match(100, 100, 1)).toBe(0);
    expect(match(100, 50, 0.5)).toBe(0);
    expect(match(0, 0, 1)).toBe(0);
  });

  it('follows the formula of the C code', () => {
    // mean = 12.5，z = 5 / √(6.8 × 12.5) ≈ 0.542，pd = 2(1 − Φ(z)) ≈ 0.588，−100 ln pd ≈ 53.2
    expect(match(10, 15, 1)).toBe(53);
  });

  it('grows with the length difference', () => {
    expect(match(100, 120, 1)).toBeLessThan(match(100, 160, 1));
    expect(match(100, 0, 1)).toBeGreaterThan(1000);
  });
});

describe('galeChurch', () => {
  it('pairs one to one when lengths line up', () => {
    expect(galeChurch([100, 50, 80], [100, 50, 80], 1)).toEqual([
      { en: [0], zh: [0] },
      { en: [1], zh: [1] },
      { en: [2], zh: [2] },
    ]);
  });

  it('uses 2:1, 1:2 and 2:2 when lengths say so', () => {
    expect(galeChurch([60, 60, 200], [120, 100, 100], 1)).toEqual([
      { en: [0, 1], zh: [0] },
      { en: [2], zh: [1, 2] },
    ]);
    expect(galeChurch([100, 300], [300, 100], 1)).toEqual([{ en: [0, 1], zh: [0, 1] }]);
  });

  it('scales by c', () => {
    expect(galeChurch([200, 100], [100, 50], 0.5)).toEqual([
      { en: [0], zh: [0] },
      { en: [1], zh: [1] },
    ]);
  });

  it('handles empty sides', () => {
    expect(galeChurch([], [10, 20], 1)).toEqual([
      { en: [], zh: [0] },
      { en: [], zh: [1] },
    ]);
  });
});
