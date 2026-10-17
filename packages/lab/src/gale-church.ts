import { normalCdf, type Pair } from '@epubmerger/core';

/**
 * Gale-Church 原版（Gale & Church 1993, "A Program for Aligning Sentences in Bilingual Corpora"），
 * 照论文附录里的 C 代码写，给 0.10 当对照组。和 core 的 lengthCost 不同的地方：
 * - 长度比 c 是一个全局常数，不按组自适应
 * - 标准差是 √(s² × mean)，不乘长度比
 * - 有 2:2；代价取整（C 代码里是 int）
 * 参数都用论文的，不调
 */

/** 论文：长度差的方差系数 */
export const VARIANCE = 6.8;

/** 论文的先验换算成相对 1:1 的惩罚：−100 × ln(P(走法) / P(1:1)) */
export const PENALTY = {
  /** 1:0、0:1 合计 0.0099 */
  skip: 450,
  /** 2:1、1:2 合计 0.089 */
  merge: 230,
  /** 2:2 0.011 */
  double: 440,
};

/** C 代码里"不可能"的代价 */
const BIG_DISTANCE = 2500;

/**
 * 一步的长度代价（C 代码的 match）：len1 英文、len2 中文，c 是"中文长度 ÷ 英文长度"。
 * 长度差至少这么大的概率越小，代价越高
 */
export function match(len1: number, len2: number, c: number): number {
  if (len1 === 0 && len2 === 0) return 0;
  const mean = (len1 + len2 / c) / 2;
  const z = Math.abs((c * len1 - len2) / Math.sqrt(VARIANCE * mean));
  const pd = 2 * (1 - normalCdf(z));
  return pd > 0 ? Math.trunc(-100 * Math.log(pd)) : BIG_DISTANCE;
}

/** [用掉几段英文, 用掉几段中文, 惩罚] */
const MOVES: readonly (readonly [number, number, number])[] = [
  [1, 1, 0],
  [1, 0, PENALTY.skip],
  [0, 1, PENALTY.skip],
  [2, 1, PENALTY.merge],
  [1, 2, PENALTY.merge],
  [2, 2, PENALTY.double],
];

/** 动态规划：每一步的代价是 match + 惩罚，取总代价最小的那条路 */
export function galeChurch(enLens: number[], zhLens: number[], c: number): Pair[] {
  const n = enLens.length;
  const m = zhLens.length;
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
  const from = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(-1));
  best[0]![0] = 0;
  const sum = (lens: number[], start: number, k: number) =>
    lens.slice(start, start + k).reduce((s, x) => s + x, 0);

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const here = best[i]![j]!;
      if (here === Infinity) continue;
      MOVES.forEach(([a, b, penalty], k) => {
        if (i + a > n || j + b > m) return;
        const total = here + match(sum(enLens, i, a), sum(zhLens, j, b), c) + penalty;
        if (total < best[i + a]![j + b]!) {
          best[i + a]![j + b] = total;
          from[i + a]![j + b] = k;
        }
      });
    }
  }

  const pairs: Pair[] = [];
  const range = (start: number, k: number) => Array.from({ length: k }, (_, x) => start + x);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const [a, b] = MOVES[from[i]![j]!]!;
    i -= a;
    j -= b;
    pairs.push({ en: range(i, a), zh: range(j, b) });
  }
  return pairs.reverse();
}
