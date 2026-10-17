// 章节边界：目录可靠就按目录切；没有或不可靠就一个 spine 文件一节；只有一个文件就全书一节。
// 2026-10-17 决定不认 <h1>–<h3> 和"第X章"这类文字（trade-off 020），没有目录时给警告，由 UI 建议换书。

import type { Book, TocEntry } from '../epub/types.ts';
import type { Block } from '../extract/types.ts';
import type { Chapter, ChapterResult, ChapterWarning, TocStats } from './types.ts';

/** 目录不可靠的门槛，在 18 本真书上量过余量（见 0.6 报告） */
const MAX_UNRESOLVED_SHARE = 0.5;
const MAX_BEFORE_TOC_SHARE = 0.5;
const MAX_LARGEST_SHARE = 0.5;

function flattenToc(entries: TocEntry[], depth: number): { entry: TocEntry; depth: number }[] {
  return entries.flatMap((entry) => [{ entry, depth }, ...flattenToc(entry.children, depth + 1)]);
}

/**
 * 目录项从第几块开始：同一文件里 ids 含锚点的块；找不到锚点就是这个文件的第一块；
 * 文件没有块就是后面第一个有块的文件的第一块。文件不在 spine 里时返回 null
 */
function tocStart(
  spineIndex: Map<string, number>,
  blocks: Block[],
  entry: TocEntry,
): number | null {
  if (entry.fragment !== null) {
    const fragment = entry.fragment;
    const i = blocks.findIndex((b) => b.file === entry.href && b.ids.includes(fragment));
    if (i >= 0) return i;
  }
  const target = spineIndex.get(entry.href);
  if (target === undefined) return null;
  const i = blocks.findIndex((b) => (spineIndex.get(b.file) ?? -1) >= target);
  return i < 0 ? blocks.length : i;
}

/**
 * 把块按起点切成节，第 i 节是 [第 i 个起点, 第 i+1 个起点)。
 * 起点先改成"只能往后走"：往回指的（目录顺序和正文顺序不一致）挪到前一个起点。
 * 这样节不重叠、也不漏；和下一项起点相同的（如"第一部"和它下面的"第 1 章"）是空节。
 * 第一个起点之前的块单独成一节（beforeToc）
 */
export function splitAt(
  blockCount: number,
  heads: { title: string; depth: number; start: number }[],
): Chapter[] {
  const starts: number[] = [];
  for (const h of heads) starts.push(Math.min(blockCount, Math.max(h.start, starts.at(-1) ?? 0)));
  const chapters: Chapter[] = [];
  const first = starts[0] ?? blockCount;
  if (first > 0) chapters.push({ title: '', depth: 0, start: 0, end: first, beforeToc: true });
  heads.forEach((h, i) => {
    chapters.push({
      title: h.title,
      depth: h.depth,
      start: starts[i]!,
      end: starts[i + 1] ?? blockCount,
    });
  });
  return chapters;
}

/** 一个 spine 文件一节，没有块的文件跳过。标题用文件里第一个标题块，没有就用文件名 */
export function splitBySpine(blocks: Block[]): Chapter[] {
  const chapters: Chapter[] = [];
  blocks.forEach((b, i) => {
    const last = chapters.at(-1);
    if (last !== undefined && blocks[last.start]!.file === b.file) last.end = i + 1;
    else chapters.push({ title: '', depth: 0, start: i, end: i + 1 });
  });
  for (const c of chapters) {
    const inFile = blocks.slice(c.start, c.end);
    const heading = inFile.find((b) => b.kind === 'heading' && b.text.trim() !== '');
    c.title = heading?.text.trim() ?? blocks[c.start]!.file.split('/').at(-1)!;
  }
  return chapters;
}

/** 正文字数：region 为 body 的块，去掉空白后的字符数 */
function bodyChars(blocks: Block[], start: number, end: number): number {
  let n = 0;
  for (let i = start; i < end; i++) {
    const b = blocks[i]!;
    if (b.region === 'body') n += b.text.replace(/\s/g, '').length;
  }
  return n;
}

/**
 * 按目录切，同时算出判断可靠性用的数字。
 * 指向 spine 以外文件的目录项起点算在书末，成为空节：和 0.4b 的规则一样，已有章节表的节号不变
 */
export function splitByToc(book: Book, blocks: Block[]): { chapters: Chapter[]; stats: TocStats } {
  const spineIndex = new Map(book.spine.map((item, i) => [item.href, i]));
  const entries = flattenToc(book.toc, 0);
  let unresolved = 0;
  const heads = entries.map(({ entry, depth }) => {
    const start = tocStart(spineIndex, blocks, entry);
    if (start === null) unresolved++;
    return { title: entry.title, depth, start: start ?? blocks.length };
  });
  const chapters = splitAt(blocks.length, heads);

  const total = bodyChars(blocks, 0, blocks.length) || 1;
  const before = chapters.find((c) => c.beforeToc);
  const tocChapters = chapters.filter((c) => !c.beforeToc);
  const stats: TocStats = {
    entries: entries.length,
    unresolvedShare: entries.length === 0 ? 0 : unresolved / entries.length,
    beforeTocShare: before === undefined ? 0 : bodyChars(blocks, before.start, before.end) / total,
    largestShare: Math.max(0, ...tocChapters.map((c) => bodyChars(blocks, c.start, c.end))) / total,
  };
  return { chapters, stats };
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** 目录不可靠的原因，可靠时为空 */
function tocProblems(
  stats: TocStats,
  spineChapterCount: number,
  tocChapterCount: number,
): string[] {
  const problems: string[] = [];
  if (stats.unresolvedShare > MAX_UNRESOLVED_SHARE) {
    problems.push(`${pct(stats.unresolvedShare)} of entries point outside the spine`);
  }
  if (stats.beforeTocShare > MAX_BEFORE_TOC_SHARE) {
    problems.push(`${pct(stats.beforeTocShare)} of body text comes before the first entry`);
  }
  if (stats.largestShare > MAX_LARGEST_SHARE && spineChapterCount > tocChapterCount) {
    problems.push(
      `one entry holds ${pct(stats.largestShare)} of body text ` +
        `(files would give ${spineChapterCount} chapters, the toc gives ${tocChapterCount})`,
    );
  }
  return problems;
}

/**
 * 切章节。目录有 2 项以上且可靠 → 按目录；否则按 spine 文件，只有一个文件时全书一节。
 * 没有块时返回空的一节
 */
export function splitChapters(book: Book, blocks: Block[]): ChapterResult {
  const warnings: ChapterWarning[] = [];
  const spineChapters = splitBySpine(blocks);
  let tocStats: TocStats | null = null;

  if (book.toc.length > 0) {
    const { chapters, stats } = splitByToc(book, blocks);
    tocStats = stats;
    if (stats.entries < 2) {
      warnings.push({ code: 'TOC_MISSING', message: 'the toc has only one entry' });
    } else {
      const tocCount = chapters.filter((c) => !c.beforeToc).length;
      const problems = tocProblems(stats, spineChapters.length, tocCount);
      if (problems.length === 0) return { source: 'toc', chapters, tocStats, warnings };
      warnings.push({ code: 'TOC_UNRELIABLE', message: problems.join('; ') });
    }
  } else {
    warnings.push({ code: 'TOC_MISSING', message: 'the book has no toc' });
  }

  if (spineChapters.length > 1)
    return { source: 'spine', chapters: spineChapters, tocStats, warnings };
  return {
    source: 'whole',
    chapters: [{ title: spineChapters[0]?.title ?? '', depth: 0, start: 0, end: blocks.length }],
    tocStats,
    warnings,
  };
}
