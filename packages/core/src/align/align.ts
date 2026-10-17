import { cosine, normalize } from './vector.ts';

/**
 * 段落配对的动态规划。英文段落排一列、中文段落排一列，从上往下走，
 * 每一步是下面一种走法，程序找总代价最小的那条路。
 * 两种方法（按长度、按意思）用同一套走法，只换代价函数，比较才公平
 */

/** [用掉几段英文, 用掉几段中文] */
export type Move = readonly [number, number];

export const MOVES: readonly Move[] = [
  [1, 1],
  [1, 0], // 跳过英文这段
  [0, 1], // 跳过中文这段
  [2, 1], // 两段英文合成一段中文
  [1, 2], // 一段英文拆成两段中文
];

/** 一步走法的代价。en、zh 是这一步用到的段落下标（跳过时另一边为空） */
export type CostFn = (en: number[], zh: number[]) => number;

export interface Pair {
  en: number[];
  zh: number[];
}

export function align(enCount: number, zhCount: number, cost: CostFn): Pair[] {
  // best[i][j]：英文前 i 段、中文前 j 段配完的最小总代价；from[i][j]：最后一步是哪种走法
  const best = Array.from({ length: enCount + 1 }, () =>
    new Array<number>(zhCount + 1).fill(Infinity),
  );
  const from = Array.from({ length: enCount + 1 }, () => new Array<number>(zhCount + 1).fill(-1));
  best[0]![0] = 0;
  const range = (start: number, n: number) => Array.from({ length: n }, (_, k) => start + k);

  for (let i = 0; i <= enCount; i++) {
    for (let j = 0; j <= zhCount; j++) {
      const here = best[i]![j]!;
      if (here === Infinity) continue;
      MOVES.forEach(([a, b], m) => {
        if (i + a > enCount || j + b > zhCount) return;
        const total = here + cost(range(i, a), range(j, b));
        if (total < best[i + a]![j + b]!) {
          best[i + a]![j + b] = total;
          from[i + a]![j + b] = m;
        }
      });
    }
  }

  // 从终点往回走，还原出每一步
  const pairs: Pair[] = [];
  let i = enCount;
  let j = zhCount;
  while (i > 0 || j > 0) {
    const [a, b] = MOVES[from[i]![j]!]!;
    i -= a;
    j -= b;
    pairs.push({ en: range(i, a), zh: range(j, b) });
  }
  return pairs.reverse();
}

/**
 * 按长度（Gale-Church）：先算这一章"中文字数 ÷ 英文字数"的比例 ratio，
 * 一步里两边的长度越接近这个比例，代价越低；再加上这种走法本身有多常见（先验概率）
 */
export interface LengthOptions {
  /** 长度差的方差系数，Gale-Church 原文用 6.8 */
  variance?: number;
}

/** Gale-Church 原文统计的各种走法的比例 */
const PRIORS: Record<string, number> = {
  '1,1': 0.89,
  '1,0': 0.0099,
  '0,1': 0.0099,
  '2,1': 0.089 / 2,
  '1,2': 0.089 / 2,
};

export function lengthCost(
  enLens: number[],
  zhLens: number[],
  options: LengthOptions = {},
): CostFn {
  const variance = options.variance ?? 6.8;
  const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);
  const ratio = sum(zhLens) / Math.max(1, sum(enLens));
  return (en, zh) => {
    const l1 = sum(en.map((i) => enLens[i]!));
    const l2 = sum(zh.map((j) => zhLens[j]!));
    const mean = (l1 + l2 / ratio) / 2;
    // 标准化的长度差：按比例换算后差多少，除以按长度增长的标准差
    const z = mean === 0 ? 0 : (l1 * ratio - l2) / Math.sqrt(variance * mean * ratio);
    // 长度差至少这么大的概率（双侧），越小越不像
    const p = Math.max(2 * (1 - normalCdf(Math.abs(z))), 1e-12);
    const prior = PRIORS[`${en.length},${zh.length}`]!;
    return -Math.log(p * prior);
  };
}

/** 标准正态分布的累积概率，用误差函数的近似公式（Abramowitz & Stegun 7.1.26，误差 < 1.5e-7） */
export function normalCdf(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * 按意思：配对的代价是 threshold − 相似度，跳过的代价是 0。
 * 所以相似度高于门槛才值得配；低于门槛，宁可两边都跳过。
 * 2:1、1:2 把多段的向量取平均再比，另加 mergePenalty，免得随便合并；
 * 但被合并的那几块都很短时（拆成两行的标题、副标题）不扣分
 */
export interface EmbeddingOptions {
  threshold: number;
  mergePenalty?: number;
  /** 每段的字数，用来判断"很短"。不给时每次合并都扣分 */
  lengths?: { en: number[]; zh: number[] };
  /** 不到这么多字算"很短"，默认 30 */
  shortLength?: number;
}

export function embeddingCost(
  enVecs: Float32Array[],
  zhVecs: Float32Array[],
  options: EmbeddingOptions,
): CostFn {
  const merge = options.mergePenalty ?? 0.05;
  const short = options.shortLength ?? 30;
  const allShort = (ids: number[], lens: number[] | undefined) =>
    lens !== undefined && ids.every((i) => lens[i]! < short);
  return (en, zh) => {
    if (en.length === 0 || zh.length === 0) return 0;
    const sim = cosine(
      meanVector(en.map((i) => enVecs[i]!)),
      meanVector(zh.map((j) => zhVecs[j]!)),
    );
    const merged = en.length > 1 ? en : zh.length > 1 ? zh : null;
    const lens = merged === en ? options.lengths?.en : options.lengths?.zh;
    const penalty = merged === null || allShort(merged, lens) ? 0 : merge;
    return options.threshold - sim + penalty;
  };
}

/**
 * 两种代价加在一起：长度代价 + lambda × 意思代价。
 * 长度代价通常在 0–20 之间，意思代价只在 ±0.1 左右，lambda 把它们拉到同一个量级；越大越听"意思"的。
 * 跳过时意思代价是 0，所以跳过的代价就是长度法的（Gale-Church 认为跳过很少见）
 */
export function combinedCost(length: CostFn, meaning: CostFn, lambda: number): CostFn {
  return (en, zh) => length(en, zh) + lambda * meaning(en, zh);
}

/** 几个向量的平均，再缩放到长度 1。只有一个时直接返回它 */
export function meanVector(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 1) return vectors[0]!;
  const out = new Float32Array(vectors[0]!.length);
  for (const v of vectors) for (let k = 0; k < v.length; k++) out[k]! += v[k]!;
  return normalize(out);
}
