import { align, embeddingCost, meanVector, type Pair } from '../align/align.ts';
import type { Embedder } from '../align/embedder.ts';
import { inBookOrder, prefillByOrder, type ChapterGroup, type Section } from './map.ts';

/**
 * 章节表的预填：有模型时按意思（0.4b、0.4a 验证过，正文章节全部配对正确），
 * 没有模型时按顺序一对一。预填只是草稿，最后由用户确认
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

export interface PrefillOptions {
  /** 不给时按顺序预填 */
  embedder?: Embedder;
  threshold?: number;
}

export interface PrefillResult {
  method: 'meaning' | 'order';
  groups: ChapterGroup[];
}

/** 预填章节表：有 embedder 时按意思，再排回书的顺序；没有时按顺序 */
export async function prefillChapters(
  en: Section[],
  zh: Section[],
  options: PrefillOptions = {},
): Promise<PrefillResult> {
  const { embedder, threshold = CHAPTER_THRESHOLD } = options;
  if (embedder === undefined) return { method: 'order', groups: prefillSectionsByOrder(en, zh) };
  const enVecs = await sectionVectors(en, embedder);
  const zhVecs = await sectionVectors(zh, embedder);
  return {
    method: 'meaning',
    groups: inBookOrder(pairByMeaning(en, zh, enVecs, zhVecs, threshold)),
  };
}
