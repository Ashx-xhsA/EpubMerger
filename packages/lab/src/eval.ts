import type { Block, Pair } from '@epubmerger/core';
import { galeChurch } from './gale-church.ts';
import type { GoldGroup } from './gold.ts';
import type { GroupResult } from './paragraphs.ts';
import { opening } from './review.ts';

/**
 * 0.10 评估：四种方法在同样的组里配段落，和标准答案（gold.json）比，算严格、宽松两种 F1。
 * 打分照 Bertalign 的 eval.py（它沿用 Vecalign 的 score.py）：
 * - 严格：一个单元两边的段落和答案完全一样才算对
 * - 宽松：不完全一样，但英文那几段在答案里配的中文，和这个单元的中文有重叠，也算对
 * - 准确率算上"没有对应"的单元（说错了扣分）；召回率两边都去掉它们
 * - 多本书合计时把次数加起来再算（micro）
 * 英文当作 Bertalign 的 source 一边
 */

export const METHODS = ['combined', 'length', 'meaning', 'galeChurch'] as const;
export type Method = (typeof METHODS)[number];

export const METHOD_NAMES: Record<Method, string> = {
  combined: '我们的方法（长度 + 意思）',
  length: '只用长度',
  meaning: '只用意思',
  galeChurch: 'Gale-Church（原版）',
};

export interface Counts {
  tpStrict: number;
  fpStrict: number;
  tpLax: number;
  fpLax: number;
}

export interface BeadCounts {
  precision: Counts;
  recall: Counts;
}

export interface PRF {
  p: number;
  r: number;
  f: number;
}

const zero = (): Counts => ({ tpStrict: 0, fpStrict: 0, tpLax: 0, fpLax: 0 });

function key(p: Pair): string {
  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b).join(',');
  return `${sorted(p.en)}|${sorted(p.zh)}`;
}

/**
 * eval.py 的 _precision：test 里每个单元在 gold 里对不对。
 * 算召回率时把两边对调传进来
 */
export function precisionCounts(gold: Pair[], test: Pair[]): Counts {
  const nonEmpty = (p: Pair) => p.en.length + p.zh.length > 0;
  const goldBeads = gold.filter(nonEmpty);
  const goldKeys = new Set(goldBeads.map(key));
  const counts = zero();
  const seen = new Set<string>();
  for (const t of test.filter(nonEmpty)) {
    const k = key(t);
    if (seen.has(k)) continue;
    seen.add(k);
    if (goldKeys.has(k)) {
      counts.tpStrict++;
      counts.tpLax++;
      continue;
    }
    counts.fpStrict++;
    const targets = new Set(
      goldBeads.filter((g) => g.en.some((i) => t.en.includes(i))).flatMap((g) => g.zh),
    );
    if (t.zh.some((j) => targets.has(j))) counts.tpLax++;
    else counts.fpLax++;
  }
  return counts;
}

export function countBeads(gold: Pair[], test: Pair[]): BeadCounts {
  const bothSides = (p: Pair) => p.en.length > 0 && p.zh.length > 0;
  return {
    precision: precisionCounts(gold, test),
    recall: precisionCounts(test.filter(bothSides), gold.filter(bothSides)),
  };
}

export function addCounts(a: BeadCounts, b: BeadCounts): BeadCounts {
  const add = (x: Counts, y: Counts): Counts => ({
    tpStrict: x.tpStrict + y.tpStrict,
    fpStrict: x.fpStrict + y.fpStrict,
    tpLax: x.tpLax + y.tpLax,
    fpLax: x.fpLax + y.fpLax,
  });
  return { precision: add(a.precision, b.precision), recall: add(a.recall, b.recall) };
}

export const noCounts = (): BeadCounts => ({ precision: zero(), recall: zero() });

export function scores(c: BeadCounts): { strict: PRF; lax: PRF } {
  const ratio = (tp: number, fp: number) => (tp + fp === 0 ? 0 : tp / (tp + fp));
  const prf = (p: number, r: number): PRF => ({ p, r, f: p + r === 0 ? 0 : (2 * p * r) / (p + r) });
  return {
    strict: prf(
      ratio(c.precision.tpStrict, c.precision.fpStrict),
      ratio(c.recall.tpStrict, c.recall.fpStrict),
    ),
    lax: prf(ratio(c.precision.tpLax, c.precision.fpLax), ratio(c.recall.tpLax, c.recall.fpLax)),
  };
}

/** 字数：去掉空白后的字符数（和 lab 的长度方法一样） */
function chars(b: Block): number {
  return b.text.replace(/\s/g, '').length;
}

/** Gale-Church 的全局长度比：所有组的中文字数 ÷ 英文字数 */
export function globalRatio(groups: GroupResult[]): number {
  const total = (side: 'en' | 'zh') =>
    groups.reduce((n, g) => n + g[side].reduce((s, b) => s + chars(b), 0), 0);
  return total('zh') / total('en');
}

/** 一组里四种方法的配对。前三种 alignBook 已经算好了 */
export function predictions(g: GroupResult, ratio: number): Record<Method, Pair[]> {
  return {
    combined: g.byCombined,
    length: g.byLength,
    meaning: g.byMeaning,
    galeChurch: galeChurch(g.en.map(chars), g.zh.map(chars), ratio),
  };
}

/** 标准答案里记的段落开头和现在抽取出来的对不上时报错（抽取改过、编号变了） */
export function checkGold(g: GroupResult, gold: GoldGroup): void {
  for (const b of gold.beads) {
    for (const side of ['en', 'zh'] as const) {
      const heads = side === 'en' ? b.enHead : b.zhHead;
      b[side].forEach((i, n) => {
        const block = g[side][i];
        if (block === undefined || opening(block.text) !== heads[n]) {
          throw new Error(
            `组 ${g.index} ${side} #${i}：标准答案是「${heads[n]}」，现在是「${block ? opening(block.text) : '（没有）'}」`,
          );
        }
      });
    }
  }
}

export interface GroupEval {
  index: number;
  title: string;
  beads: number;
  counts: Record<Method, BeadCounts>;
}

export function evalGroups(groups: GroupResult[], gold: GoldGroup[], ratio: number): GroupEval[] {
  const byIndex = new Map(gold.map((g) => [g.index, g]));
  return groups.map((g) => {
    const answer = byIndex.get(g.index);
    if (answer === undefined) throw new Error(`组 ${g.index} 没有标准答案`);
    checkGold(g, answer);
    const p = predictions(g, ratio);
    const counts = Object.fromEntries(
      METHODS.map((m) => [m, countBeads(answer.beads, p[m])]),
    ) as Record<Method, BeadCounts>;
    return { index: g.index, title: g.zhTitle || g.enTitle, beads: answer.beads.length, counts };
  });
}

export function total(groups: GroupEval[]): Record<Method, BeadCounts> {
  return Object.fromEntries(
    METHODS.map((m) => [m, groups.reduce((c, g) => addCounts(c, g.counts[m]), noCounts())]),
  ) as Record<Method, BeadCounts>;
}

const pct = (x: number) => (100 * x).toFixed(1).padStart(5);

export function formatTable(counts: Record<Method, BeadCounts>): string {
  const lines = [`${'方法'.padEnd(20)}  严格  P     R     F1   │ 宽松  P     R     F1`];
  for (const m of METHODS) {
    const s = scores(counts[m]);
    lines.push(
      `${METHOD_NAMES[m].padEnd(20)}       ${pct(s.strict.p)} ${pct(s.strict.r)} ${pct(s.strict.f)} │       ${pct(s.lax.p)} ${pct(s.lax.r)} ${pct(s.lax.f)}`,
    );
  }
  return lines.join('\n');
}
