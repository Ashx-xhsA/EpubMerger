import { readFileSync } from 'node:fs';
import type { Block } from '@epubmerger/core';
import type { Pair } from './align.ts';
import { escapeHtml } from './chapters.ts';
import { partners, type AlignOptions, type GroupResult } from './paragraphs.ts';

/**
 * 人工检查段落配对：先生成、再纠错。
 * 每一行是合并法配出的一对；长度法或意思法配得不一样的是"黄色行"，由 Claude 先判断，人再复查。
 * 判断结果用段落开头的文字来记（不用编号），算法改了、编号变了也还能用
 */

export interface Row {
  group: number;
  /** 合并法的第几对 */
  k: number;
  pair: Pair;
  /** 配得不一样的方法，以及它们给这一行的段落配的是哪段（"3+4"，空字符串是跳过） */
  others: { name: string; zh: string[]; en: string[] }[];
}

export function rows(g: GroupResult): Row[] {
  const methods = [
    { name: '按长度', pairs: g.byLength },
    { name: '按意思', pairs: g.byMeaning },
  ].map((m) => ({
    name: m.name,
    zh: partners(m.pairs, 'zh', g.zh.length),
    en: partners(m.pairs, 'en', g.en.length),
  }));
  return g.byCombined.map((pair, k) => {
    const mine = (ids: number[]) => ids.join('+');
    const others = methods
      .filter(
        (m) =>
          pair.zh.some((j) => m.zh[j] !== mine(pair.en)) ||
          pair.en.some((i) => m.en[i] !== mine(pair.zh)),
      )
      .map((m) => ({
        name: m.name,
        zh: pair.zh.map((j) => m.zh[j]!),
        en: pair.en.map((i) => m.en[i]!),
      }));
    return { group: g.index, k, pair, others };
  });
}

/** 一条判断。一行由"组 + 中文开头"认出来；中文为空的行用"组 + 英文开头" */
export interface Verdict {
  group: number;
  zh?: string;
  en?: string;
  /** true 对，false 错，null 不确定 */
  ok: boolean | null;
  /** 错的时候，正确的英文是以这些开头的段落；空数组表示没有对应 */
  answer?: string[];
  note?: string;
  /** 谁判断的 */
  by?: 'claude' | 'human';
  /** 判断时这段的编号。同样的开头出现好几次时，用它选最近的那段 */
  at?: number;
}

/** 比较开头时只看字母、数字、汉字，引号、空格、标点的写法不同不影响 */
export function normalized(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

const KEY_LENGTH = 40;

/** 记判断用的开头：原文的前 40 个字符 */
export function opening(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, KEY_LENGTH);
}

/** 这一行的"身份"：中文第一段的开头；没有中文时用英文第一段的开头 */
export function rowKey(g: GroupResult, row: Row): { zh?: string; en?: string } {
  const zh = row.pair.zh[0];
  if (zh !== undefined) return { zh: opening(g.zh[zh]!.text) };
  return { en: opening(g.en[row.pair.en[0]!]!.text) };
}

/** 一行在它那一边的位置：有中文时是中文第一段的编号，否则是英文第一段的编号 */
export function rowAt(row: Row): number {
  return row.pair.zh[0] ?? row.pair.en[0]!;
}

/**
 * 把判断分给这一组的行，返回"第几对 → 判断"。开头对得上的行里，选离 at 最近的那行
 * （没有 at 时就是第一行）。每条判断只分给一行；几条判断争同一行时，开头长的（更具体的）先挑。
 * 同样的文字会出现好几次（信末的签名"皮拉内西"），所以需要 at
 */
export function assignVerdicts(
  g: GroupResult,
  groupRows: Row[],
  verdicts: Verdict[],
): Map<number, Verdict> {
  const assigned = new Map<number, Verdict>();
  const key = (v: Verdict) => v.zh ?? v.en ?? '';
  const mine = verdicts
    .filter((v) => v.group === g.index)
    .sort((a, b) => key(b).length - key(a).length);
  for (const v of mine) {
    const side = v.zh !== undefined ? 'zh' : 'en';
    const candidates = groupRows.filter((row) => {
      if (assigned.has(row.k)) return false;
      // 中文的判断对有中文的行；英文的判断只对没有中文的行
      const first =
        side === 'zh' ? row.pair.zh[0] : row.pair.zh.length === 0 ? row.pair.en[0] : undefined;
      return first !== undefined && matches(g[side][first]!.text, v[side]);
    });
    const at = v.at ?? 0;
    const best = candidates.sort((a, b) => Math.abs(rowAt(a) - at) - Math.abs(rowAt(b) - at))[0];
    if (best) assigned.set(best.k, v);
  }
  return assigned;
}

/**
 * 段落是不是以 key 开头（只比字母、数字、汉字）。key 不到 4 个字符时（"预言家""FROM"）
 * 要求整段就是它，免得配到别的以同样文字开头的段落上
 */
export function matches(text: string, key: string | undefined): boolean {
  if (key === undefined) return false;
  const mine = normalized(text);
  const k = normalized(key);
  return mine === k || (k.length >= 4 && mine.startsWith(k));
}

function headTail(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ');
  return t.length <= 2 * n ? t : `${t.slice(0, n)} …… ${t.slice(-n)}`;
}

function describe(blocks: Block[], ids: number[], n: number): string {
  if (ids.length === 0) return '（没有对应）';
  return ids.map((i) => `#${i} ${headTail(blocks[i]!.text, n)}`).join('\n      ');
}

/**
 * 把黄色行导出成紧凑的文本，给 Claude 逐行判断：
 * 中文、合并法配的英文、其他方法配的英文，都只列开头和结尾
 */
export function dumpReview(groups: GroupResult[]): string {
  const out: string[] = [];
  for (const g of groups) {
    for (const row of rows(g)) {
      if (row.others.length === 0) continue;
      const { zh, en } = row.pair;
      out.push(
        `── [${g.index}] 第 ${row.k} 对 · 中 ${zh.join('+') || '-'} · 英 ${en.join('+') || '-'}`,
      );
      out.push(`  中：${describe(g.zh, zh, 80)}`);
      out.push(`  合并：${describe(g.en, en, 120)}`);
      for (const o of row.others) {
        // 只列和合并法不一样的那些段落
        // 有中文的行，列出它给这些中文配的英文；没有中文的行，列出它给这段英文配的中文
        const where = zh.length > 0 ? o.zh : o.en;
        const ids = [...new Set(where.flatMap((s) => (s === '' ? [] : s.split('+').map(Number))))];
        out.push(`  ${o.name}：${where.map((s) => s || '跳过').join(' / ')}`);
        for (const i of ids) {
          if (zh.length > 0 && en.includes(i)) continue;
          const text = zh.length > 0 ? g.en[i]!.text : g.zh[i]!.text;
          out.push(`      ${zh.length > 0 ? '英' : '中'} #${i} ${headTail(text, 120)}`);
        }
      }
    }
  }
  return out.join('\n');
}

/**
 * 正确答案的开头 → 这一组里的段落编号（"12+13"）；没有对应是"无"，找不到的写成 ?。
 * 先按原样找（区分大小写，THE PROPHET 和 The Prophet 是两段），找不到再放宽；
 * 有好几段都对得上时，选离 near（这一行的位置）最近的
 */
export function answerIds(answer: string[], blocks: Block[], near: number): string {
  if (answer.length === 0) return '无';
  const nearest = (ids: number[]) => ids.sort((a, b) => Math.abs(a - near) - Math.abs(b - near))[0];
  return answer
    .map((a) => {
      const all = blocks.map((_, i) => i);
      const exact = all.filter((i) => blocks[i]!.text.replace(/\s+/g, ' ').startsWith(a));
      const i = nearest(exact.length > 0 ? exact : all.filter((i) => matches(blocks[i]!.text, a)));
      return i === undefined ? '?' : String(i);
    })
    .join('+');
}

const CLIENT = readFileSync(new URL('./review-client.js', import.meta.url), 'utf8');

/**
 * 可以操作的检查页：在段落配对页的基础上，每行加 ✓ ✗ ? 按钮。
 * 黄色行预先填好 Claude 的判断；人的修改存在浏览器里，可以导出成 JSON
 */
export function reviewHtml(
  book: string,
  groups: GroupResult[],
  verdicts: Verdict[],
  options: AlignOptions,
): string {
  const data = {
    book,
    en: {} as Record<number, string[]>,
    zh: {} as Record<number, string[]>,
    rows: [] as unknown[],
  };
  const sections = groups.map((g) => {
    data.en[g.index] = g.en.map((b) => opening(b.text));
    data.zh[g.index] = g.zh.map((b) => opening(b.text));
    const groupRows = rows(g);
    const assigned = assignVerdicts(g, groupRows, verdicts);
    const trs = groupRows.map((row) => {
      const i = data.rows.length;
      const key = rowKey(g, row);
      const side = key.zh !== undefined ? 'zh' : 'en';
      const v = assigned.get(row.k);
      const at = rowAt(row);
      // 正确答案在另一边的大概位置：这一行在另一边有段落就用它，没有就按比例估
      const near =
        side === 'zh'
          ? (row.pair.en[0] ?? Math.round((at * g.en.length) / Math.max(1, g.zh.length)))
          : (row.pair.zh[0] ?? Math.round((at * g.zh.length) / Math.max(1, g.en.length)));
      data.rows.push({
        key: `${g.index}|${side}:${at}:${key.zh ?? key.en}`,
        at,
        group: g.index,
        side,
        opening: key.zh ?? key.en,
        yellow: row.others.length > 0,
        init: v
          ? {
              ok: v.ok,
              answer:
                v.ok === false ? answerIds(v.answer ?? [], side === 'zh' ? g.en : g.zh, near) : '',
              answerOpenings: v.answer,
              note: v.note ?? '',
              by: v.by ?? 'claude',
            }
          : null,
      });
      const cell = (blocks: Block[], ids: number[], lang: string) =>
        ids.length === 0
          ? '<td class="skip">（没有对应）</td>'
          : `<td lang="${lang}">${ids.map((n) => `<p><span class="id">#${n}</span>${escapeHtml(blocks[n]!.text)}</p>`).join('')}</td>`;
      const { en, zh } = row.pair;
      const sim =
        en.length > 0 && zh.length > 0
          ? Math.max(...en.flatMap((a) => zh.map((b) => g.sim[a]![b]!))).toFixed(2)
          : '';
      const alts = row.others
        .map((o) => {
          const where =
            zh.length > 0
              ? zh.map((j, n) => `中 #${j} → ${o.zh[n] === '' ? '跳过' : `英 #${o.zh[n]}`}`)
              : en.map((a, n) => `英 #${a} → ${o.en[n] === '' ? '跳过' : `中 #${o.en[n]}`}`);
          return `<div class="alt"><b>${o.name}</b>：${where.join('；')}</div>`;
        })
        .join('');
      return `<tr data-i="${i}" class="${row.others.length > 0 ? 'yellow' : ''}">${cell(g.en, en, 'en')}${cell(g.zh, zh, 'zh')}<td class="side"><div class="sim">${sim}</div>${alts}<div class="verdict"></div></td></tr>`;
    });
    return `<section class="group"><h2>[${g.index}] ${escapeHtml(g.enTitle)} ↔ ${escapeHtml(g.zhTitle)}</h2>
<table><thead><tr><th>English</th><th>中文</th><th>判断</th></tr></thead><tbody>
${trs.join('\n')}
</tbody></table></section>`;
  });
  for (const i of pickSample(data.rows as SampleCandidate[], SAMPLE_SIZE)) {
    (data.rows[i] as { sample?: boolean }).sample = true;
  }
  // 放进 <script> 前把 < 换成转义，书里的文字碰巧有 </script> 时也不会把页面弄断
  const json = JSON.stringify(data).replace(/</g, '\\x3c');

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(book)} · 段落检查</title>
<style>
:root { --bg: #fafaf9; --card: #fff; --text: #1c1917; --muted: #78716c; --line: #e7e5e4; --yellow: #fef9c3; --ok: #15803d; --ok-soft: #dcfce7; --bad: #b91c1c; --bad-soft: #fee2e2; --unsure: #a16207; --accent: #2563eb; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1c1917; --card: #292524; --text: #f5f5f4; --muted: #a8a29e; --line: #44403c; --yellow: #3f3a1a; --ok: #4ade80; --ok-soft: #14361f; --bad: #f87171; --bad-soft: #4c1d1d; --unsure: #facc15; --accent: #60a5fa; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 0 16px 48px; background: var(--bg); color: var(--text); font: 15px/1.6 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
main { max-width: 1200px; margin: 0 auto; }
header { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 1px solid var(--line); padding: 16px 0 12px; }
h1 { font-size: 20px; margin: 0 0 4px; }
.help { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
.bar { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 14px; }
#stats .bad { color: var(--bad); }
select, button, input { font: inherit; font-size: 13px; }
header button { padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--text); cursor: pointer; }
h2 { font-size: 16px; margin: 28px 0 6px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; background: var(--card); }
th, td { border-bottom: 1px solid var(--line); padding: 8px; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
th { color: var(--muted); font-weight: 600; }
th:nth-child(3), td.side { width: 210px; }
td p { margin: 0 0 6px; }
.id { color: var(--accent); font-size: 11px; margin-right: 6px; font-variant-numeric: tabular-nums; }
tr.yellow { background: var(--yellow); }
tr.v-bad td:first-child { box-shadow: inset 4px 0 var(--bad); }
tr.v-ok td:first-child { box-shadow: inset 4px 0 var(--ok); }
tr.v-unsure td:first-child { box-shadow: inset 4px 0 var(--unsure); }
tr.sample:not(.v-ok):not(.v-bad):not(.v-unsure) td:first-child { box-shadow: inset 4px 0 var(--accent); }
.verdict .tag { font-size: 11px; padding: 0 6px; border-radius: 4px; background: var(--accent); color: var(--card); margin-right: 2px; }
td.skip { color: var(--muted); }
.sim { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.alt { font-size: 12px; margin-top: 2px; }
.alt b { font-weight: 600; }
.verdict { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.verdict button { width: 30px; height: 26px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--text); cursor: pointer; }
.verdict button.small { width: auto; padding: 0 8px; font-size: 12px; }
tr.v-ok .verdict button.on { background: var(--ok-soft); border-color: var(--ok); color: var(--ok); }
tr.v-bad .verdict button.on { background: var(--bad-soft); border-color: var(--bad); color: var(--bad); }
tr.v-unsure .verdict button.on { border-color: var(--unsure); color: var(--unsure); }
.verdict label { font-size: 12px; width: 100%; }
.verdict input { width: 100%; margin-top: 2px; padding: 2px 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--text); }
.verdict .note { font-size: 12px; color: var(--muted); width: 100%; }
@media (max-width: 640px) { th:nth-child(3), td.side { width: 120px; } body { font-size: 14px; } }
</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(book)} · 段落检查</h1>
<p class="help">每行是合并法（长度 + ${options.lambda} × 意思，门槛 ${options.threshold}）配出的一对。黄色行是长度法或意思法配得不一样的地方，Claude 已经预先判断（左边绿条 = 对，红条 = 错，黄条 = 不确定）。白色行没检查，有问题就点 ✗，填上正确答案的编号。修改会存在这个浏览器里；看完点"导出"，把下载的文件交给 Claude。</p>
<div class="bar">
<label>显示 <select id="filter">
<option value="all">全部</option>
<option value="yellow">黄色行</option>
<option value="bad">判为错的</option>
<option value="unsure">不确定的</option>
<option value="human">你改过的</option>
<option value="unchecked">没检查的</option>
<option value="sample">要你检查的（抽查）</option>
</select></label>
<button type="button" id="export">导出判断结果</button>
<button type="button" id="reset">清除我的修改</button>
</div>
<p id="stats" class="help" style="margin:8px 0 0"></p>
</header>
${sections.join('\n')}
</main>
<script>window.REVIEW_DATA = ${json};</script>
<script>
${CLIENT}
</script>
</body>
</html>
`;
}

/** 每本书给人抽查多少行白色行 */
export const SAMPLE_SIZE = 50;

export interface SampleCandidate {
  key: string;
  yellow: boolean;
  init: unknown;
}

/** 32 位 FNV-1a 哈希：同样的文字总是得到同样的数，用来做"固定的随机" */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 从白色行（两种方法和合并法一致、也没人判断过的行）里挑 size 行给人抽查。
 * 按每行身份的哈希排序后取前几个：看起来是随机的，但每次重新生成网页挑出的都是同一批
 */
export function pickSample(candidates: SampleCandidate[], size: number): number[] {
  return candidates
    .map((r, i) => ({ i, r }))
    .filter(({ r }) => !r.yellow && r.init === null)
    .sort((a, b) => fnv1a(a.r.key) - fnv1a(b.r.key))
    .slice(0, size)
    .map(({ i }) => i)
    .sort((a, b) => a - b);
}
