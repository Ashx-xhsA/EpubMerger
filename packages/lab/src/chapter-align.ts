import { align, combinedCost, embeddingCost, lengthCost, meanVector, type Pair } from './align.ts';
import type { Section, Group } from './chapters.ts';
import { prefill } from './chapters.ts';
import type { Embedder } from './embed.ts';

/**
 * 章节自动配对测试：不靠人，程序自己配章节，和用户确认过的章节表比，看能对多少。
 * 四种方法：按顺序预填、按长度、按意思、两者合并。都用段落配对那套走法（1:1、1:2、2:1、跳过）
 */

function sectionChars(s: Section): number {
  return s.blocks.reduce((n, b) => n + b.text.replace(/\s/g, '').length, 0);
}

/** 节的开头和结尾各取大约 n 个字 */
export function headAndTail(s: Section, n = 1000): { head: string; tail: string } {
  const text = s.blocks.map((b) => b.text).join('\n');
  return { head: `${s.title}\n${text.slice(0, n)}`, tail: text.slice(-n) };
}

/**
 * 每节一个向量：开头一个、结尾一个，取平均。分开算是因为 e5 一次只看 512 个 token，
 * 中文 2,000 字放在一起会被截掉大半
 */
export async function sectionVectors(
  sections: Section[],
  embedder: Embedder,
): Promise<Float32Array[]> {
  const parts = sections.flatMap((s) => {
    const { head, tail } = headAndTail(s);
    return [head, tail];
  });
  const vectors = await embedder.embed(parts);
  return sections.map((_, i) => meanVector([vectors[2 * i]!, vectors[2 * i + 1]!]));
}

export interface Prediction {
  /** 预测的配对，节号是整本书里的编号；一边为空表示不合并 */
  groups: Group[];
}

/** 没有块的节（如只指向扉页的目录项）不参与配对，直接算不合并 */
function nonEmpty(sections: Section[]): number[] {
  return sections.flatMap((s, i) => (s.blocks.length > 0 ? [i] : []));
}

/** 把在"非空节"上配出的结果换回整本书的节号，再把空节补成不合并的组 */
function toGroups(
  pairs: Pair[],
  enIds: number[],
  zhIds: number[],
  en: Section[],
  zh: Section[],
): Group[] {
  const groups: Group[] = pairs.map((p) => ({
    en: p.en.map((i) => enIds[i]!),
    zh: p.zh.map((j) => zhIds[j]!),
  }));
  en.forEach((s, i) => s.blocks.length === 0 && groups.push({ en: [i], zh: [] }));
  zh.forEach((s, j) => s.blocks.length === 0 && groups.push({ en: [], zh: [j] }));
  return groups;
}

export interface ChapterOptions {
  threshold: number;
  lambda: number;
}

export function predictAll(
  en: Section[],
  zh: Section[],
  enVecs: Float32Array[],
  zhVecs: Float32Array[],
  options: ChapterOptions,
): Record<'order' | 'length' | 'meaning' | 'combined', Group[]> {
  const enIds = nonEmpty(en);
  const zhIds = nonEmpty(zh);
  const length = lengthCost(
    enIds.map((i) => sectionChars(en[i]!)),
    zhIds.map((j) => sectionChars(zh[j]!)),
  );
  const meaning = embeddingCost(
    enIds.map((i) => enVecs[i]!),
    zhIds.map((j) => zhVecs[j]!),
    { threshold: options.threshold },
  );
  const run = (cost: Parameters<typeof align>[2]) =>
    toGroups(align(enIds.length, zhIds.length, cost), enIds, zhIds, en, zh);
  return {
    order: prefill(en.length, zh.length, (side, i) =>
      side === 'en' ? en[i]!.blocks.length === 0 : zh[i]!.blocks.length === 0,
    ),
    length: run(length),
    meaning: run(meaning),
    combined: run(combinedCost(length, meaning, options.lambda)),
  };
}

const key = (ids: number[]) => ids.join('+');

/** 预测里，含有这一节的那组 */
function groupOf(predicted: Group[], side: 'en' | 'zh', i: number): Group | undefined {
  return predicted.find((g) => g[side].includes(i));
}

export interface ChapterScore {
  /** 正确答案里两边都有的组：预测出了完全一样的组 */
  paired: { correct: number; total: number };
  /** 正确答案里不合并的组：预测里这些节也都不合并 */
  unmerged: { correct: number; total: number };
  /** 和正确答案不一样的组数，即用户打开章节表要改的行数 */
  toFix: number;
  /** 每组正确答案对不对，和正确答案同顺序 */
  perGroup: boolean[];
}

/** 和用户确认过的章节表比。只有空节的组不计（它们总是不合并） */
export function scoreChapters(
  truth: Group[],
  predicted: Group[],
  en: Section[],
  zh: Section[],
): ChapterScore {
  const score: ChapterScore = {
    paired: { correct: 0, total: 0 },
    unmerged: { correct: 0, total: 0 },
    toFix: 0,
    perGroup: [],
  };
  for (const t of truth) {
    const realEn = t.en.filter((i) => en[i]!.blocks.length > 0);
    const realZh = t.zh.filter((j) => zh[j]!.blocks.length > 0);
    let ok: boolean;
    if (realEn.length === 0 && realZh.length === 0) {
      score.perGroup.push(true);
      continue;
    }
    if (t.en.length > 0 && t.zh.length > 0) {
      const p = groupOf(predicted, 'en', realEn[0] ?? t.en[0]!);
      ok =
        p !== undefined &&
        key(p.en.filter((i) => en[i]!.blocks.length > 0)) === key(realEn) &&
        key(p.zh.filter((j) => zh[j]!.blocks.length > 0)) === key(realZh);
      score.paired.total++;
      if (ok) score.paired.correct++;
    } else {
      const side = t.en.length > 0 ? 'en' : 'zh';
      const ids = side === 'en' ? realEn : realZh;
      ok = ids.every((i) => {
        const p = groupOf(predicted, side, i);
        return p !== undefined && p[side === 'en' ? 'zh' : 'en'].length === 0;
      });
      score.unmerged.total++;
      if (ok) score.unmerged.correct++;
    }
    if (!ok) score.toFix++;
    score.perGroup.push(ok);
  }
  return score;
}

/** 预测把这一组正确答案配成了什么，给网页显示："EN 7 ↔ ZH 2+3"、"不合并" */
export function describePrediction(t: Group, predicted: Group[]): string {
  const side = t.en.length > 0 ? 'en' : 'zh';
  // 正确答案是"不合并"时，列出被配了出去的那些节；否则看第一节被配成了什么
  const ids = t.en.length > 0 && t.zh.length > 0 ? [t.en[0]!] : t[side];
  const paired = ids
    .map((i) => groupOf(predicted, side, i))
    .filter((p): p is Group => p !== undefined && p.en.length > 0 && p.zh.length > 0);
  if (paired.length === 0) return '不合并';
  return [...new Set(paired.map((p) => `EN ${key(p.en)} ↔ ZH ${key(p.zh)}`))].join('；');
}

const METHOD_NAMES = {
  order: '按顺序',
  length: '按长度',
  meaning: '按意思',
  combined: '合并',
} as const;

/** 每本书一个网页：每行一组正确答案，后面每种方法一列，对的打 ✓，错的写出它配成了什么 */
export function chapterTestHtml(
  book: string,
  truth: Group[],
  en: Section[],
  zh: Section[],
  predictions: Record<keyof typeof METHOD_NAMES, Group[]>,
  options: ChapterOptions,
): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const methods = Object.keys(METHOD_NAMES) as (keyof typeof METHOD_NAMES)[];
  const scores = methods.map((m) => scoreChapters(truth, predictions[m], en, zh));
  const titles = (ids: number[], sections: Section[], side: string) =>
    ids.length === 0
      ? '<span class="muted">（不合并）</span>'
      : ids
          .map(
            (i) =>
              `<div><span class="id">${side} ${i}</span>${esc(sections[i]!.title)}${sections[i]!.blocks.length === 0 ? ' <span class="muted">（空）</span>' : ''}</div>`,
          )
          .join('');
  const rows = truth.map((t, k) => {
    const cells = methods.map((m, n) =>
      scores[n]!.perGroup[k]
        ? '<td class="ok">✓</td>'
        : `<td class="bad">✗ ${esc(describePrediction(t, predictions[m]))}</td>`,
    );
    return `<tr><td>${titles(t.en, en, 'EN')}</td><td>${titles(t.zh, zh, 'ZH')}</td>${cells.join('')}</tr>`;
  });
  const summary = methods
    .map((m, n) => {
      const s = scores[n]!;
      return `<tr><td>${METHOD_NAMES[m]}</td><td class="n">${s.paired.correct}/${s.paired.total}</td><td class="n">${s.unmerged.correct}/${s.unmerged.total}</td><td class="n"><b>${s.toFix}</b></td></tr>`;
    })
    .join('');
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(book)} · 章节自动配对</title>
<style>
:root { --bg: #fafaf9; --card: #fff; --text: #1c1917; --muted: #78716c; --line: #e7e5e4; --ok: #15803d; --bad: #b91c1c; --bad-soft: #fee2e2; --accent: #2563eb; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --card: #292524; --text: #f5f5f4; --muted: #a8a29e; --line: #44403c; --ok: #4ade80; --bad: #f87171; --bad-soft: #4c1d1d; --accent: #60a5fa; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--text); font: 15px/1.6 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 28px 0 8px; }
.muted { color: var(--muted); }
table { width: 100%; border-collapse: collapse; background: var(--card); font-size: 14px; }
th, td { border-bottom: 1px solid var(--line); padding: 7px 9px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { color: var(--muted); font-weight: 600; }
td.n { text-align: right; font-variant-numeric: tabular-nums; }
td.ok { color: var(--ok); text-align: center; }
td.bad { color: var(--bad); background: var(--bad-soft); font-size: 12px; }
.id { color: var(--accent); font-size: 11px; margin-right: 6px; font-variant-numeric: tabular-nums; }
.summary { max-width: 520px; }
@media (max-width: 640px) { body { font-size: 14px; } td.bad { font-size: 11px; } }
</style>
</head>
<body>
<main>
<h1>${esc(book)} · 章节自动配对</h1>
<p class="muted">正确答案是你确认过的章节表。按意思用 e5，门槛 ${options.threshold}；合并 = 长度 + ${options.lambda} × 意思。空节（没有正文的目录项）总是不合并，不计分。</p>
<h2>汇总</h2>
<table class="summary"><thead><tr><th>方法</th><th class="n">正文配对</th><th class="n">不合并</th><th class="n">要改几行</th></tr></thead><tbody>${summary}</tbody></table>
<h2>逐组</h2>
<table><thead><tr><th>English</th><th>中文</th>${methods.map((m) => `<th>${METHOD_NAMES[m]}</th>`).join('')}</tr></thead><tbody>
${rows.join('\n')}
</tbody></table>
</main>
</body>
</html>
`;
}
