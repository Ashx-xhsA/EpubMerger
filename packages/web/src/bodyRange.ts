// 第一步"正文范围"的数据和操作（1.6）。不依赖 React，组件 BodyRange.tsx 只负责显示。
// 范围是两本书各自正文的第一节和最后一节；首尾之外的节不合并，中间按长度预填章节表。
// core 的 Anchor 用 en / zh 表示第一本 / 第二本，这里沿用

import { pairLengthsFromAnchor } from '@epubmerger/core';
import { linksFromGroups, type Link } from './chapterTable.ts';
import type { BodyRange, PreparedChapters, SectionInfo } from './pipeline.ts';

export type Side = 'first' | 'second';

const key = (side: Side) => (side === 'first' ? 'en' : 'zh');

/** 设开头。最后一次操作说了算：开头跑到结尾后面时，结尾跟着移过来 */
export function setStart(range: BodyRange, side: Side, index: number): BodyRange {
  const k = key(side);
  return {
    from: { ...range.from, [k]: index },
    to: { ...range.to, [k]: Math.max(range.to[k], index) },
  };
}

/** 设结尾。结尾跑到开头前面时，开头跟着移过来 */
export function setEnd(range: BodyRange, side: Side, index: number): BodyRange {
  const k = key(side);
  return {
    from: { ...range.from, [k]: Math.min(range.from[k], index) },
    to: { ...range.to, [k]: index },
  };
}

export function sameRange(a: BodyRange, b: BodyRange): boolean {
  return (
    a.from.en === b.from.en && a.from.zh === b.from.zh && a.to.en === b.to.en && a.to.zh === b.to.zh
  );
}

export function startOf(range: BodyRange, side: Side): number {
  return range.from[key(side)];
}

export function endOf(range: BodyRange, side: Side): number {
  return range.to[key(side)];
}

/** 一栏里要显示的东西：一节，或者折起来的中间那一段 */
export type RangeRow = { kind: 'section'; index: number } | { kind: 'gap'; indices: number[] };

/**
 * 一栏里显示哪些节：开头之前的、开头往后 around 节、结尾往前 around 节、结尾之后的都显示，
 * 中间的折成一行（只有一节时不折）。showEmpty 为 false 时不显示没有正文的节
 */
export function visibleRows(
  sections: SectionInfo[],
  start: number,
  end: number,
  options: { around?: number; expanded?: boolean; showEmpty?: boolean } = {},
): RangeRow[] {
  const { around = 2, expanded = false, showEmpty = false } = options;
  const shown = sections.flatMap((s, i) => (showEmpty || !s.empty ? [i] : []));
  const hidden = expanded
    ? []
    : shown.filter((i) => i > start && i < end).slice(around, -around || undefined);
  if (hidden.length < 2) return shown.map((index) => ({ kind: 'section', index }));
  const rows: RangeRow[] = [];
  for (const index of shown) {
    if (index === hidden[0]) rows.push({ kind: 'gap', indices: hidden });
    else if (!hidden.includes(index)) rows.push({ kind: 'section', index });
  }
  return rows;
}

/** 按正文范围预填章节表：首尾之外不合并，中间按长度配（trade-off 033） */
export function prefillFromRange(info: PreparedChapters, range: BodyRange): Link[] {
  const chars = (sections: SectionInfo[]) => sections.map((s) => (s.empty ? 0 : s.chars));
  return linksFromGroups(
    pairLengthsFromAnchor(chars(info.first), chars(info.second), range.from, range.to),
  );
}
