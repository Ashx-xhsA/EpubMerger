import { existsSync, readFileSync } from 'node:fs';
import type { Block } from '@epubmerger/core';
import { align, combinedCost, embeddingCost, lengthCost, type Pair } from './align.ts';
import { embedSorted } from './bench.ts';
import { withCache } from './cache.ts';
import { bookSections, escapeHtml, mapPath, type ChapterMap } from './chapters.ts';
import { cosine, loadEmbedder, type ModelKey } from './embed.ts';

/**
 * 段落配对实验：在用户确认过的每组章节里，按长度、按意思（embedding）各配一次，
 * 再比较两种方法哪里一致、哪里不一致
 */

export interface GroupResult {
  /** 章节表里第几组 */
  index: number;
  enTitle: string;
  zhTitle: string;
  en: Block[];
  zh: Block[];
  byLength: Pair[];
  byMeaning: Pair[];
  /** 两种代价加在一起（lambda 见 AlignOptions） */
  byCombined: Pair[];
  /** 每段中文在这组英文里最像的那段的相似度 */
  bestSim: number[];
  /** sim[i][j]：英文第 i 段和中文第 j 段的相似度 */
  sim: number[][];
  enVecs: Float32Array[];
  zhVecs: Float32Array[];
  /** 只有符号、没参与配对的块数（两边加起来） */
  symbols: number;
}

export interface AlignOptions {
  /** 按意思的门槛 */
  threshold: number;
  /** 合并代价里意思代价的权重 */
  lambda: number;
}

/** 字数：去掉空白后的字符数，长度方法用 */
function chars(b: Block): number {
  return b.text.replace(/\s/g, '').length;
}

/** 一个字母、数字、汉字都没有的块（"—""◆◆◆◆""* * *"）。它们不参与配对，生成 ePub 时放回原位 */
export function isSymbolOnly(b: Block): boolean {
  return !/[\p{L}\p{N}]/u.test(b.text);
}

/** 三种方法在一组里的配对。compare 命令换 lambda 时也用它 */
export function alignGroup(
  en: Block[],
  zh: Block[],
  enVecs: Float32Array[],
  zhVecs: Float32Array[],
  options: AlignOptions,
): { byLength: Pair[]; byMeaning: Pair[]; byCombined: Pair[] } {
  const lengths = { en: en.map(chars), zh: zh.map(chars) };
  const length = lengthCost(lengths.en, lengths.zh);
  const meaning = embeddingCost(enVecs, zhVecs, { threshold: options.threshold, lengths });
  return {
    byLength: align(en.length, zh.length, length),
    byMeaning: align(en.length, zh.length, meaning),
    byCombined: align(en.length, zh.length, combinedCost(length, meaning, options.lambda)),
  };
}

export async function alignBook(
  enPath: string,
  zhPath: string,
  model: ModelKey,
  options: AlignOptions,
): Promise<GroupResult[]> {
  if (!existsSync(mapPath(enPath))) throw new Error(`no chapter map: run pnpm lab chapters first`);
  const map = JSON.parse(readFileSync(mapPath(enPath), 'utf8')) as ChapterMap;
  const enSections = bookSections(enPath);
  const zhSections = bookSections(zhPath);
  const groups = map.groups
    .map((g, index) => {
      const en = g.en.flatMap((i) => enSections[i]!.blocks);
      const zh = g.zh.flatMap((i) => zhSections[i]!.blocks);
      const keep = (b: Block) => !isSymbolOnly(b);
      return {
        index,
        enTitle: g.en.map((i) => enSections[i]!.title).join(' + '),
        zhTitle: g.zh.map((i) => zhSections[i]!.title).join(' + '),
        en: en.filter(keep),
        zh: zh.filter(keep),
        symbols: en.length + zh.length - en.filter(keep).length - zh.filter(keep).length,
      };
    })
    .filter((g) => g.en.length > 0 && g.zh.length > 0);

  // 全书要用到的段落一次算完（有缓存），再按组取用
  const embedder = withCache(await loadEmbedder(model));
  const texts = groups.flatMap((g) => [...g.en, ...g.zh].map((b) => b.text));
  const vectors = await embedSorted(embedder, texts);
  let at = 0;

  return groups.map((g) => {
    const enVecs = vectors.slice(at, (at += g.en.length));
    const zhVecs = vectors.slice(at, (at += g.zh.length));
    const sim = enVecs.map((a) => zhVecs.map((b) => cosine(a, b)));
    return {
      ...g,
      ...alignGroup(g.en, g.zh, enVecs, zhVecs, options),
      bestSim: g.zh.map((_, j) => Math.max(...sim.map((row) => row[j]!))),
      sim,
      enVecs,
      zhVecs,
    };
  });
}

/** judged.json 里的一条：第 group 组里以 zh 开头的中文段落，正确的英文是以 en 各项开头的段落 */
export interface JudgedCase {
  group: number;
  zh: string;
  en: string[];
}

/** 比较开头时只看字母、数字、汉字，引号、空格、标点的写法不同不影响 */
function normalized(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export interface JudgedScore {
  correct: number;
  total: number;
  /** 在书里找不到的条目（判断时的段落被改掉了），不计入 total */
  notFound: string[];
  /** 配错的条目：中文开头、配到的英文开头，排查用 */
  wrong: string[];
}

/** 用人工判断过的条目给一种方法打分。pick 从一组的结果里取出这种方法的配对 */
export function scoreJudged(
  groups: GroupResult[],
  cases: JudgedCase[],
  pick: (g: GroupResult) => Pair[],
): JudgedScore {
  const score: JudgedScore = { correct: 0, total: 0, notFound: [], wrong: [] };
  for (const c of cases) {
    const g = groups.find((x) => x.index === c.group);
    const j = g?.zh.findIndex((b) => normalized(b.text).startsWith(normalized(c.zh))) ?? -1;
    if (!g || j < 0) {
      score.notFound.push(`[${c.group}] ${c.zh}`);
      continue;
    }
    score.total++;
    const ids = partners(pick(g), 'zh', g.zh.length)[j]!;
    const got = ids === '' ? [] : ids.split('+').map((i) => g.en[Number(i)]!.text);
    const ok =
      got.length === c.en.length &&
      got.every((t, k) => normalized(t).startsWith(normalized(c.en[k]!)));
    if (ok) score.correct++;
    else {
      const heads = got.length === 0 ? '（跳过）' : got.map((t) => t.slice(0, 50)).join(' ‖ ');
      score.wrong.push(`[${c.group}] ${c.zh} → ${heads}`);
    }
  }
  return score;
}

/** 每段中文被配给了哪几段英文（"3+4"，跳过时是空字符串）。英文那边同理 */
export function partners(pairs: Pair[], side: 'en' | 'zh', count: number): string[] {
  const out = new Array<string>(count).fill('');
  const other = side === 'en' ? 'zh' : 'en';
  for (const p of pairs) for (const i of p[side]) out[i] = p[other].join('+');
  return out;
}

export interface Agreement {
  zh: number;
  zhTotal: number;
  en: number;
  enTotal: number;
}

/** 两种方法给同一段的配对一样的比例（中文、英文分开算） */
export function agreement(groups: GroupResult[]): Agreement {
  const result = { zh: 0, zhTotal: 0, en: 0, enTotal: 0 };
  for (const g of groups) {
    for (const side of ['zh', 'en'] as const) {
      const count = g[side].length;
      const a = partners(g.byLength, side, count);
      const b = partners(g.byMeaning, side, count);
      result[side] += a.filter((x, i) => x === b[i]).length;
      result[`${side}Total`] += count;
    }
  }
  return result;
}

function quantiles(xs: number[]): string {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!.toFixed(2);
  return `最小 ${q(0)} · 10% ${q(0.1)} · 25% ${q(0.25)} · 中位 ${q(0.5)} · 75% ${q(0.75)} · 最大 ${q(1)}`;
}

function head(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ');
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 终端里看的统计：每组段数、两种方法的一致率、相似度分布、最不像的中文段落 */
export function formatSummary(groups: GroupResult[]): string {
  const lines: string[] = [];
  for (const g of groups) {
    const a = agreement([g]);
    lines.push(
      `[${g.index}] ${g.enTitle} ↔ ${g.zhTitle}：英 ${g.en.length} 段、中 ${g.zh.length} 段，` +
        `一致 ${a.zh}/${a.zhTotal}`,
    );
  }
  const a = agreement(groups);
  const all = groups.flatMap((g) => g.bestSim);
  lines.push(
    '',
    `两种方法一致：中文 ${a.zh}/${a.zhTotal}（${pct(a.zh, a.zhTotal)}），英文 ${a.en}/${a.enTotal}（${pct(a.en, a.enTotal)}）`,
    `每段中文的最高相似度：${quantiles(all)}`,
    '',
    '最不像的 15 段中文：',
  );
  const lowest = groups
    .flatMap((g) => g.zh.map((b, j) => ({ g, j, text: b.text, s: g.bestSim[j]! })))
    .sort((x, y) => x.s - y.s)
    .slice(0, 15);
  for (const x of lowest) lines.push(`  ${x.s.toFixed(2)} [${x.g.index}] ${head(x.text, 60)}`);
  return lines.join('\n');
}

function pct(n: number, total: number): string {
  return `${((100 * n) / Math.max(1, total)).toFixed(1)}%`;
}

/**
 * 两种方法不一致的中文段落，给人逐个判断：中文原文、按意思配的英文、按长度配的英文。
 * 连在一起的几段算一处，每处只列一次
 */
export function disagreements(groups: GroupResult[]): string {
  const out: string[] = [];
  let n = 0;
  for (const g of groups) {
    const byLen = partners(g.byLength, 'zh', g.zh.length);
    const byMean = partners(g.byMeaning, 'zh', g.zh.length);
    const text = (ids: string) =>
      ids === ''
        ? '（跳过）'
        : ids
            .split('+')
            .map((i) => `#${i} ${head(g.en[Number(i)]!.text, 160)}`)
            .join(' ‖ ');
    g.zh.forEach((b, j) => {
      if (byLen[j] === byMean[j]) return;
      if (j > 0 && byLen[j - 1] !== byMean[j - 1]) return;
      n++;
      const sim = (ids: string) =>
        ids === ''
          ? ''
          : ` (sim ${Math.max(...ids.split('+').map((i) => g.sim[Number(i)]![j]!)).toFixed(2)})`;
      out.push(
        `── 第 ${n} 处 · 组 [${g.index}] · 中 #${j}`,
        `  中：${head(b.text, 120)}`,
        `  意思${sim(byMean[j]!)}：${text(byMean[j]!)}`,
        `  长度${sim(byLen[j]!)}：${text(byLen[j]!)}`,
      );
    });
  }
  return out.join('\n');
}

/** 网页版：每组一张表，按"按意思"的配对一行一行列出；按长度配得不一样的行标黄，并写出长度配的是哪段 */
/** 两种配对给同样多少段中文配了同样的英文 */
function sameZh(a: Pair[], b: Pair[], count: number): number {
  const x = partners(a, 'zh', count);
  const y = partners(b, 'zh', count);
  return x.filter((v, i) => v === y[i]).length;
}

/**
 * 网页版：每组一张表，按"合并法"的配对一行一行列出。
 * 长度法或意思法配得不一样的行标黄，并写出它们各自配的是哪段
 */
export function paragraphsHtml(
  title: string,
  groups: GroupResult[],
  options: AlignOptions,
): string {
  let sameLen = 0;
  let sameMean = 0;
  let total = 0;
  const sections = groups.map((g) => {
    const others = [
      {
        name: '按长度',
        zh: partners(g.byLength, 'zh', g.zh.length),
        en: partners(g.byLength, 'en', g.en.length),
      },
      {
        name: '按意思',
        zh: partners(g.byMeaning, 'zh', g.zh.length),
        en: partners(g.byMeaning, 'en', g.en.length),
      },
    ];
    const rows = g.byCombined.map((p) => {
      const mine = (ids: number[]) => ids.join('+');
      const notes = others
        .filter(
          (o) =>
            p.zh.some((j) => o.zh[j] !== mine(p.en)) || p.en.some((i) => o.en[i] !== mine(p.zh)),
        )
        .map((o) => {
          const where =
            p.zh.length > 0
              ? p.zh.map((j) => `中 #${j} → ${o.zh[j] === '' ? '跳过' : `英 #${o.zh[j]}`}`)
              : p.en.map((i) => `英 #${i} → ${o.en[i] === '' ? '跳过' : `中 #${o.en[i]}`}`);
          return `<div class="alt"><b>${o.name}</b>：${where.join('；')}</div>`;
        });
      const sim =
        p.en.length > 0 && p.zh.length > 0
          ? Math.max(...p.en.flatMap((i) => p.zh.map((j) => g.sim[i]![j]!))).toFixed(2)
          : '';
      const cell = (blocks: Block[], ids: number[], side: string) =>
        ids.length === 0
          ? '<td class="skip">（没有对应）</td>'
          : `<td lang="${side}">${ids.map((i) => `<p><span class="id">#${i}</span>${escapeHtml(blocks[i]!.text)}</p>`).join('')}</td>`;
      return `<tr class="${notes.length > 0 ? 'diff' : ''}">${cell(g.en, p.en, 'en')}${cell(g.zh, p.zh, 'zh')}<td class="sim">${sim}${notes.join('')}</td></tr>`;
    });
    const sl = sameZh(g.byCombined, g.byLength, g.zh.length);
    const sm = sameZh(g.byCombined, g.byMeaning, g.zh.length);
    sameLen += sl;
    sameMean += sm;
    total += g.zh.length;
    const symbols = g.symbols > 0 ? ` · 另有 ${g.symbols} 个只有符号的块没参与配对` : '';
    return `<h2>[${g.index}] ${escapeHtml(g.enTitle)} ↔ ${escapeHtml(g.zhTitle)}</h2>
<p class="meta">英 ${g.en.length} 段 · 中 ${g.zh.length} 段 · 和长度法一致 ${sl}/${g.zh.length} · 和意思法一致 ${sm}/${g.zh.length}${symbols}</p>
<table><thead><tr><th>English</th><th>中文</th><th>相似度 · 其他方法</th></tr></thead><tbody>
${rows.join('\n')}
</tbody></table>`;
  });
  const summary = `每行是<b>合并法</b>（长度 + ${options.lambda} × 意思，e5 门槛 ${options.threshold}）配出的一组。黄色的行，长度法或意思法配得不一样，右边写着它们配的是哪段。<br>
和长度法一致：中文 ${sameLen}/${total}（${pct(sameLen, total)}）· 和意思法一致：中文 ${sameMean}/${total}（${pct(sameMean, total)}）`;

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · 段落配对</title>
<style>
:root { --bg: #fafaf9; --card: #fff; --text: #1c1917; --muted: #78716c; --line: #e7e5e4; --diff: #fef9c3; --accent: #2563eb; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1c1917; --card: #292524; --text: #f5f5f4; --muted: #a8a29e; --line: #44403c; --diff: #3f3a1a; --accent: #60a5fa; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--text); font: 15px/1.6 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
main { max-width: 1200px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 32px 0 4px; }
.meta, .summary { color: var(--muted); margin: 0 0 8px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; background: var(--card); }
th, td { border-bottom: 1px solid var(--line); padding: 8px; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
th { color: var(--muted); font-weight: 600; }
th:nth-child(3), td.sim { width: 120px; }
td p { margin: 0 0 6px; }
.id { color: var(--accent); font-size: 11px; margin-right: 6px; font-variant-numeric: tabular-nums; }
tr.diff { background: var(--diff); }
td.skip { color: var(--muted); }
td.sim { font-variant-numeric: tabular-nums; color: var(--muted); }
.alt { font-size: 12px; color: var(--text); margin-top: 4px; }
.alt b { font-weight: 600; }
@media (max-width: 640px) { th:nth-child(3), td.sim { width: 72px; } body { font-size: 14px; } }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)} · 段落配对</h1>
<p class="summary">${summary}</p>
${sections.join('\n')}
</main>
</body>
</html>
`;
}
