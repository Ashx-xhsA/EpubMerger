import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extractBlocks, parseEpub, type Block, type Book, type TocEntry } from '@epubmerger/core';
import { alignableBlocks } from './bench.ts';

/**
 * 章节对照表：模拟产品里"按顺序预填 + 用户确认"那一步（trade-off 016）。
 * 书按目录切成一节一节，表里每一组写"英文哪几节 ↔ 中文哪几节"，一边为空就是不合并
 */

/** 按目录切出来的一节 */
export interface Section {
  title: string;
  /** 目录里的层级，0 是最外层 */
  depth: number;
  /** 这一节里要参与配对的块（不含索引、脚注、图片） */
  blocks: Block[];
}

export interface Group {
  en: number[];
  zh: number[];
  /** 只给人看：两边的标题 */
  titles?: { en: string[]; zh: string[] };
}

export interface ChapterMap {
  groups: Group[];
}

function flattenToc(entries: TocEntry[], depth: number): { entry: TocEntry; depth: number }[] {
  return entries.flatMap((entry) => [{ entry, depth }, ...flattenToc(entry.children, depth + 1)]);
}

/**
 * 目录项从第几块开始：同一文件里 ids 含锚点的块；找不到锚点就是这个文件的第一块；
 * 文件没有块就是后面第一个有块的文件的第一块。和 cli 的 tocStart 一样，0.6 会重写
 */
function tocStart(book: Book, all: Block[], entry: TocEntry): number {
  if (entry.fragment !== null) {
    const fragment = entry.fragment;
    const i = all.findIndex((b) => b.file === entry.href && b.ids.includes(fragment));
    if (i >= 0) return i;
  }
  const spineIndex = new Map(book.spine.map((item, i) => [item.href, i]));
  const target = spineIndex.get(entry.href);
  if (target === undefined) return all.length;
  const i = all.findIndex((b) => (spineIndex.get(b.file) ?? -1) >= target);
  return i < 0 ? all.length : i;
}

/**
 * 把块按目录项的起点切成节，第 i 节是 [第 i 个起点, 第 i+1 个起点)。
 * 起点先改成"只能往后走"：往回指的（目录顺序和正文顺序不一致）挪到前一个起点。
 * 这样节不重叠、也不漏；和下一项起点相同的（如"第一部"和它下面的"第 1 章"）是空节。
 * 第一个起点之前的块单独成一节"（目录前）"
 */
export function splitSections(
  all: Block[],
  heads: { title: string; depth: number; start: number }[],
): Section[] {
  const starts: number[] = [];
  for (const h of heads) starts.push(Math.min(all.length, Math.max(h.start, starts.at(-1) ?? 0)));
  const sections: Section[] = [];
  const first = starts[0] ?? all.length;
  if (first > 0) sections.push({ title: '（目录前）', depth: 0, blocks: all.slice(0, first) });
  heads.forEach((h, i) => {
    const blocks = all.slice(starts[i], starts[i + 1] ?? all.length);
    sections.push({ title: h.title || '（空标题）', depth: h.depth, blocks });
  });
  return sections.map((s) => ({ ...s, blocks: alignableBlocks(s.blocks) }));
}

export function bookSections(path: string): Section[] {
  const result = parseEpub(readFileSync(path));
  if (!result.ok) throw new Error(`${path}: ${result.error.code}`);
  const { book } = result;
  const all = extractBlocks(book).blocks;
  const heads = flattenToc(book.toc, 0).map(({ entry, depth }) => ({
    title: entry.title,
    depth,
    start: tocStart(book, all, entry),
  }));
  return splitSections(all, heads);
}

/** 按顺序一对一预填。没有块的节和多出来的节各自成一组、另一边为空（不合并） */
export function prefill(
  enCount: number,
  zhCount: number,
  isEmpty?: (side: 'en' | 'zh', i: number) => boolean,
): Group[] {
  const empty = isEmpty ?? (() => false);
  const en = [...Array(enCount).keys()];
  const zh = [...Array(zhCount).keys()];
  const groups: Group[] = [];
  let i = 0;
  let j = 0;
  while (i < en.length || j < zh.length) {
    if (i < en.length && empty('en', i)) groups.push({ en: [i++], zh: [] });
    else if (j < zh.length && empty('zh', j)) groups.push({ en: [], zh: [j++] });
    else if (i < en.length && j < zh.length) groups.push({ en: [i++], zh: [j++] });
    else if (i < en.length) groups.push({ en: [i++], zh: [] });
    else groups.push({ en: [], zh: [j++] });
  }
  return groups;
}

/**
 * 检查对照表：每一节恰好出现一次；每组里的节号连续；
 * 组按顺序往前走（后一组的节号都比前一组大），不能交叉。返回发现的问题，没有问题时为空
 */
export function validate(groups: Group[], enCount: number, zhCount: number): string[] {
  const problems: string[] = [];
  for (const side of ['en', 'zh'] as const) {
    const count = side === 'en' ? enCount : zhCount;
    const seen = groups.flatMap((g) => g[side]);
    const sorted = [...seen].sort((a, b) => a - b);
    if (seen.join() !== sorted.join()) problems.push(`${side}: sections are out of order`);
    const expected = [...Array(count).keys()];
    if (sorted.join() !== expected.join()) {
      const missing = expected.filter((i) => !seen.includes(i));
      const extra = seen.filter((i, k) => i < 0 || i >= count || seen.indexOf(i) !== k);
      if (missing.length > 0) problems.push(`${side}: missing ${missing.join(', ')}`);
      if (extra.length > 0) problems.push(`${side}: duplicate or unknown ${extra.join(', ')}`);
    }
    groups.forEach((g, k) => {
      const ids = g[side];
      if (ids.some((id, n) => n > 0 && id !== ids[n - 1]! + 1)) {
        problems.push(`group ${k}: ${side} sections are not consecutive`);
      }
    });
  }
  groups.forEach((g, k) => {
    if (g.en.length === 0 && g.zh.length === 0) problems.push(`group ${k} is empty`);
  });
  return problems;
}

/** 开头约 200 个字：中文按字数，英文按单词数（约 50 个词） */
export function preview(blocks: Block[], side: 'en' | 'zh'): string {
  const text = blocks
    .map((b) => b.text)
    .join(' / ')
    .replace(/\s+/g, ' ');
  if (side === 'zh') return text.length > 200 ? text.slice(0, 200) + '…' : text;
  const words = text.split(' ');
  return words.length > 50 ? words.slice(0, 50).join(' ') + ' …' : text;
}

function chars(blocks: Block[]): number {
  return blocks.reduce((n, b) => n + b.text.replace(/\s/g, '').length, 0);
}

/** 对照表放在书对的文件夹里，和书一样不进 git */
export function mapPath(enPath: string): string {
  return join(dirname(enPath), 'chapters.json');
}

/** 程序预填的那份表：确认前存一份，之后不再改，用来和确认过的表比 */
export function predictedPath(enPath: string): string {
  return join(dirname(enPath), 'chapters.predicted.json');
}

/** 给每组配上两边的标题，只给人看 */
export function withTitles(groups: Group[], en: Section[], zh: Section[]): Group[] {
  return groups.map((g) => ({
    en: g.en,
    zh: g.zh,
    titles: { en: g.en.map((i) => en[i]!.title), zh: g.zh.map((i) => zh[i]!.title) },
  }));
}

/**
 * 把组排回书的顺序：有英文的组按英文节号排，只有中文的组插到第一个中文节号比它大的组前面。
 * 按意思预填时，没有内容的节不参与配对、被放在最后，这里把它们放回原位，配对本身不变
 */
export function inBookOrder(groups: Group[]): Group[] {
  const out = groups.filter((g) => g.en.length > 0).sort((a, b) => a.en[0]! - b.en[0]!);
  for (const g of groups) {
    if (g.en.length > 0) continue;
    const k = out.findIndex((h) => h.zh.length > 0 && h.zh[0]! > g.zh[0]!);
    out.splice(k === -1 ? out.length : k, 0, g);
  }
  return out;
}

export function writeMap(path: string, map: ChapterMap): void {
  writeFileSync(path, JSON.stringify(map, null, 2) + '\n');
}

/** 读对照表；不存在就按顺序预填一份写进去。已有的文件不会被覆盖 */
export function loadOrCreateMap(enPath: string, en: Section[], zh: Section[]): ChapterMap {
  const path = mapPath(enPath);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as ChapterMap;
  const groups = prefill(en.length, zh.length, (side, i) =>
    side === 'en' ? en[i]!.blocks.length === 0 : zh[i]!.blocks.length === 0,
  );
  const map = { groups: withTitles(groups, en, zh) };
  writeMap(path, map);
  return map;
}

/** 把对照表并排打印出来：每组左英右中，附上段数、字数和开头预览 */
export function formatMap(map: ChapterMap, en: Section[], zh: Section[]): string {
  const lines: string[] = [];
  const describe = (sections: Section[], ids: number[], side: 'en' | 'zh') => {
    if (ids.length === 0) return ['    （不合并）'];
    const blocks = ids.flatMap((i) => sections[i]!.blocks);
    const titles = ids.map((i) => `${'  '.repeat(sections[i]!.depth)}[${i}] ${sections[i]!.title}`);
    return [
      ...titles.map((t) => `    ${t}`),
      `    ${blocks.length} 段 · ${chars(blocks)} 字`,
      `    ${preview(blocks, side)}`,
    ];
  };
  map.groups.forEach((g, k) => {
    lines.push(
      `── 第 ${k} 组`,
      '  EN',
      ...describe(en, g.en, 'en'),
      '  ZH',
      ...describe(zh, g.zh, 'zh'),
    );
  });
  return lines.join('\n');
}

/** 把文字放进 HTML 前要转义，否则书里碰巧有 < 或 & 时会把页面弄乱 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 对照表的网页版：左英右中，每组一行，每节一个小方块（标题、段数字数、开头预览）。
 * 有一边为空的组是"不合并"，整行变灰，空的那边显示虚线框
 */
export function mapHtml(
  title: string,
  map: ChapterMap,
  en: Section[],
  zh: Section[],
  problems: string[],
): string {
  const card = (sections: Section[], i: number, side: 'en' | 'zh') => {
    const s = sections[i];
    // 表里写错了节号时也要能显示出来，错误本身列在页面顶部
    if (!s) return `<div class="empty">没有 ${side.toUpperCase()} ${i} 这一节</div>`;
    return `<div class="card" style="margin-left:${s.depth * 12}px">
  <div class="title"><span class="id">${side.toUpperCase()} ${i}</span>${escapeHtml(s.title)}</div>
  <div class="meta">${s.blocks.length} 段 · ${chars(s.blocks)} 字</div>
  <div class="preview" lang="${side === 'en' ? 'en' : 'zh'}">${escapeHtml(preview(s.blocks, side))}</div>
</div>`;
  };
  const column = (sections: Section[], ids: number[], side: 'en' | 'zh') =>
    ids.length === 0
      ? '<div class="empty">不合并</div>'
      : ids.map((i) => card(sections, i, side)).join('\n');
  const rows = map.groups
    .map((g, k) => {
      const skipped = g.en.length === 0 || g.zh.length === 0;
      return `<section class="group${skipped ? ' skipped' : ''}">
<div class="num">${k}</div>
<div class="col">${column(en, g.en, 'en')}</div>
<div class="col">${column(zh, g.zh, 'zh')}</div>
</section>`;
    })
    .join('\n');
  const paired = map.groups.filter((g) => g.en.length > 0 && g.zh.length > 0).length;
  const status =
    problems.length === 0
      ? '<p class="ok">检查通过</p>'
      : `<ul class="bad">${problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`;

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · 章节对照表</title>
<style>
:root { --bg: #fafaf9; --card: #fff; --text: #1c1917; --muted: #78716c; --line: #e7e5e4; --skip: #f5f5f4; --ok: #15803d; --bad: #b91c1c; --accent: #2563eb; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1c1917; --card: #292524; --text: #f5f5f4; --muted: #a8a29e; --line: #44403c; --skip: #231f1d; --ok: #4ade80; --bad: #f87171; --accent: #60a5fa; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--text); font: 15px/1.6 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
.summary { color: var(--muted); margin: 0 0 8px; }
.ok { color: var(--ok); margin: 0 0 16px; }
.bad { color: var(--bad); margin: 0 0 16px; }
.head, .group { display: grid; grid-template-columns: 32px 1fr 1fr; gap: 12px; }
.head { position: sticky; top: 0; background: var(--bg); padding: 8px 0; font-weight: 600; color: var(--muted); border-bottom: 1px solid var(--line); z-index: 1; }
.group { padding: 12px 0; border-bottom: 1px solid var(--line); }
.group.skipped { background: var(--skip); }
.group.skipped .card { opacity: 0.6; }
.num { color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; padding-top: 10px; }
.col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
.title { font-weight: 600; overflow-wrap: anywhere; }
.id { display: inline-block; font-size: 11px; font-weight: 500; color: var(--accent); margin-right: 8px; font-variant-numeric: tabular-nums; }
.meta { font-size: 13px; color: var(--muted); }
.preview { font-size: 13px; margin-top: 4px; overflow-wrap: anywhere; }
.empty { border: 1px dashed var(--line); border-radius: 8px; padding: 10px 12px; color: var(--muted); text-align: center; }
@media (max-width: 640px) {
  .head { display: none; }
  .group { grid-template-columns: 1fr; gap: 8px; }
  .num { text-align: left; padding-top: 0; }
  .num::before { content: "第 "; } .num::after { content: " 组"; }
}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="summary">英文 ${en.length} 节 · 中文 ${zh.length} 节 · ${map.groups.length} 组，其中 ${paired} 组配对，${map.groups.length - paired} 组不合并</p>
${status}
<div class="head"><div></div><div>English</div><div>中文</div></div>
${rows}
</main>
</body>
</html>
`;
}
