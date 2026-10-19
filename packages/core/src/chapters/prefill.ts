import { align, embeddingCost, lengthCost, meanVector, type Pair } from '../align/align.ts';
import type { Embedder } from '../align/embedder.ts';
import { inBookOrder, prefillByOrder, type ChapterGroup, type Section } from './map.ts';

/**
 * 章节表的预填：有模型时按意思（0.4b、0.4a 验证过，正文章节全部配对正确），
 * 没有模型时按长度或按顺序。预填只是草稿，最后由用户确认
 */

/** 按意思配对的门槛：相似度高于它才值得配（0.4b 定的，0.4a 在新书上没改） */
export const CHAPTER_THRESHOLD = 0.75;

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

/** 没有块的节（如只指向扉页的目录项）不参与配对，直接算不合并 */
export function nonEmpty(sections: Section[]): number[] {
  return sections.flatMap((s, i) => (s.blocks.length > 0 ? [i] : []));
}

/** 把在"非空节"上配出的结果换回整本书的节号，再把空节补成不合并的组（放在最后） */
export function toGroups(
  pairs: Pair[],
  enIds: number[],
  zhIds: number[],
  en: Section[],
  zh: Section[],
): ChapterGroup[] {
  const groups: ChapterGroup[] = pairs.map((p) => ({
    en: p.en.map((i) => enIds[i]!),
    zh: p.zh.map((j) => zhIds[j]!),
  }));
  en.forEach((s, i) => s.blocks.length === 0 && groups.push({ en: [i], zh: [] }));
  zh.forEach((s, j) => s.blocks.length === 0 && groups.push({ en: [], zh: [j] }));
  return groups;
}

/** 按顺序预填，空节各自成一组 */
export function prefillSectionsByOrder(en: Section[], zh: Section[]): ChapterGroup[] {
  return prefillByOrder(en.length, zh.length, (side, i) =>
    side === 'en' ? en[i]!.blocks.length === 0 : zh[i]!.blocks.length === 0,
  );
}

/** 按意思配对（1:1、1:2、2:1、跳过），结果没有排回书的顺序，空节在最后 */
export function pairByMeaning(
  en: Section[],
  zh: Section[],
  enVecs: Float32Array[],
  zhVecs: Float32Array[],
  threshold: number,
): ChapterGroup[] {
  const enIds = nonEmpty(en);
  const zhIds = nonEmpty(zh);
  const cost = embeddingCost(
    enIds.map((i) => enVecs[i]!),
    zhIds.map((j) => zhVecs[j]!),
    { threshold },
  );
  return toGroups(align(enIds.length, zhIds.length, cost), enIds, zhIds, en, zh);
}

/** 一节的字数，不算空白 */
export function sectionChars(s: Section): number {
  return s.blocks.reduce((n, b) => n + b.text.replace(/\s/g, '').length, 0);
}

/**
 * 按长度配对（Gale-Church，和段落用同一个长度代价），不需要模型。
 * 0.4a / 0.4b 里用户要改的行比按顺序少（9 本合计 93 vs 170）。结果没有排回书的顺序，空节在最后
 */
export function pairByLength(en: Section[], zh: Section[]): ChapterGroup[] {
  return pairLengths(en.map(charsOrZero), zh.map(charsOrZero));
}

/** 字数；没有块的节算 0（空节） */
const charsOrZero = (s: Section) => (s.blocks.length === 0 ? 0 : sectionChars(s));

/**
 * 按长度配对，只要每节的字数（0 是空节）。网页主线程只有字数没有正文，用这个版本；
 * 结果和 pairByLength 一样：没有排回书的顺序，空节在最后
 */
export function pairLengths(enChars: number[], zhChars: number[]): ChapterGroup[] {
  const ids = (chars: number[]) => chars.flatMap((n, i) => (n > 0 ? [i] : []));
  const enIds = ids(enChars);
  const zhIds = ids(zhChars);
  const cost = lengthCost(
    enIds.map((i) => enChars[i]!),
    zhIds.map((j) => zhChars[j]!),
  );
  const groups: ChapterGroup[] = align(enIds.length, zhIds.length, cost).map((p) => ({
    en: p.en.map((i) => enIds[i]!),
    zh: p.zh.map((j) => zhIds[j]!),
  }));
  enChars.forEach((n, i) => n === 0 && groups.push({ en: [i], zh: [] }));
  zhChars.forEach((n, j) => n === 0 && groups.push({ en: [], zh: [j] }));
  return groups;
}

/** 两本书里的一节，一边一个：正文的第一节或最后一节（用户在章节表之前选，或者 guessAnchors 猜的） */
export interface Anchor {
  en: number;
  zh: number;
}

/**
 * 从第一章配到最后一章：首尾之外的节（版权页、目录、后记、下一本的试读……）一律不合并，
 * 中间按长度配。两头的杂页长度对不上，是按长度预填错开的主要原因（1.6）。to 不给时一直配到最后。
 * 结果按书的顺序排
 */
export function pairFromAnchor(
  en: Section[],
  zh: Section[],
  from: Anchor,
  to?: Anchor,
): ChapterGroup[] {
  return pairLengthsFromAnchor(en.map(charsOrZero), zh.map(charsOrZero), from, to);
}

/** pairFromAnchor 只要字数的版本，网页主线程用 */
export function pairLengthsFromAnchor(
  enChars: number[],
  zhChars: number[],
  from: Anchor,
  to: Anchor = { en: enChars.length - 1, zh: zhChars.length - 1 },
): ChapterGroup[] {
  // 范围外的节当成空节：不参与配对，各自成为不合并的一组
  const cut = (chars: number[], lo: number, hi: number) =>
    chars.map((n, i) => (i < lo || i > hi ? 0 : n));
  return inBookOrder(pairLengths(cut(enChars, from.en, to.en), cut(zhChars, from.zh, to.zh)));
}

export interface PrefillOptions {
  /** 不给时按 fallback 预填 */
  embedder?: Embedder;
  threshold?: number;
  /** 没有模型时用哪种，默认按顺序 */
  fallback?: 'order' | 'length';
}

export interface PrefillResult {
  method: 'meaning' | 'length' | 'order';
  groups: ChapterGroup[];
}

/** 预填章节表：有 embedder 时按意思；没有时按 fallback（按长度或按顺序）。都按书的顺序排 */
export async function prefillChapters(
  en: Section[],
  zh: Section[],
  options: PrefillOptions = {},
): Promise<PrefillResult> {
  const { embedder, threshold = CHAPTER_THRESHOLD, fallback = 'order' } = options;
  if (embedder === undefined) {
    return fallback === 'length'
      ? { method: 'length', groups: inBookOrder(pairByLength(en, zh)) }
      : { method: 'order', groups: prefillSectionsByOrder(en, zh) };
  }
  const enVecs = await sectionVectors(en, embedder);
  const zhVecs = await sectionVectors(zh, embedder);
  return {
    method: 'meaning',
    groups: inBookOrder(pairByMeaning(en, zh, enVecs, zhVecs, threshold)),
  };
}
