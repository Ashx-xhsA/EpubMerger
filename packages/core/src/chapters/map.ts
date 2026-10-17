import type { Block } from '../extract/types.ts';
import type { ChapterResult } from './types.ts';

/**
 * 章节对照表：英文哪几节 ↔ 中文哪几节，一边为空就是不合并。
 * 程序预填一份，用户确认、修改后，段落只在同一组里配（trade-off 016）
 */

/** 一节里参与配对的内容。节号就是它在 splitChapters 结果里的位置 */
export interface Section {
  title: string;
  /** 目录里的层级，0 是最外层 */
  depth: number;
  /** 这一节里要参与配对的块（不含索引、脚注、图片） */
  blocks: Block[];
}

export interface ChapterGroup {
  en: number[];
  zh: number[];
  /** 只给人看：两边的标题 */
  titles?: { en: string[]; zh: string[] };
}

export interface ChapterMap {
  groups: ChapterGroup[];
}

/** 要参与配对的块：去掉索引、脚注（结构上确定的非正文，见 trade-off 015）、图片和空块 */
export function alignableBlocks(blocks: Block[]): Block[] {
  return blocks.filter(
    (b) =>
      b.region !== 'index' && b.region !== 'notes' && b.kind !== 'image' && b.text.trim() !== '',
  );
}

/** 把 splitChapters 切出的节变成 Section，每节只留参与配对的块 */
export function chapterSections(result: ChapterResult, blocks: Block[]): Section[] {
  return result.chapters.map((c) => ({
    title: c.beforeToc ? '（目录前）' : c.title || '（空标题）',
    depth: c.depth,
    blocks: alignableBlocks(blocks.slice(c.start, c.end)),
  }));
}

/** 按顺序一对一预填。没有块的节和多出来的节各自成一组、另一边为空（不合并） */
export function prefillByOrder(
  enCount: number,
  zhCount: number,
  isEmpty?: (side: 'en' | 'zh', i: number) => boolean,
): ChapterGroup[] {
  const empty = isEmpty ?? (() => false);
  const en = [...Array(enCount).keys()];
  const zh = [...Array(zhCount).keys()];
  const groups: ChapterGroup[] = [];
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
export function validateChapterMap(
  groups: ChapterGroup[],
  enCount: number,
  zhCount: number,
): string[] {
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

/** 给每组配上两边的标题，只给人看 */
export function withTitles(groups: ChapterGroup[], en: Section[], zh: Section[]): ChapterGroup[] {
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
export function inBookOrder(groups: ChapterGroup[]): ChapterGroup[] {
  const out = groups.filter((g) => g.en.length > 0).sort((a, b) => a.en[0]! - b.en[0]!);
  for (const g of groups) {
    if (g.en.length > 0) continue;
    const k = out.findIndex((h) => h.zh.length > 0 && h.zh[0]! > g.zh[0]!);
    out.splice(k === -1 ? out.length : k, 0, g);
  }
  return out;
}
