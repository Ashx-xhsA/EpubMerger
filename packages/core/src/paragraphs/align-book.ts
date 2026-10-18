import type { Pair } from '../align/align.ts';
import type { ChapterGroup, Section } from '../chapters/map.ts';
import type { Block } from '../extract/types.ts';
import { alignParagraphs, type ParagraphOptions } from './align-paragraphs.ts';

/**
 * 整本书的段落配对：按用户确认过的章节表，一组一组调用 alignParagraphs。
 * 再把编号换成块本身，按骨架书排成"骨架 ↔ 另一本"，生成 ePub 用
 */

export interface GroupAlignment {
  /** 这一组在章节表里的位置 */
  index: number;
  /** 这一组两边参与配对的块，pairs 里的编号就是这里的位置 */
  en: Block[];
  zh: Block[];
  pairs: Pair[];
}

export interface BookAlignment {
  method: 'combined' | 'length';
  /** 两边都有块的组，按章节表的顺序；一边没有块的组（不合并）不在这里 */
  groups: GroupAlignment[];
}

export interface BookOptions extends ParagraphOptions {
  /** 每处理完一组调用一次（跳过的组也算），最后一次是 (total, total) */
  onProgress?: (done: number, total: number) => void;
}

export async function alignBook(
  groups: ChapterGroup[],
  en: Section[],
  zh: Section[],
  options: BookOptions = {},
): Promise<BookAlignment> {
  const { onProgress, ...paragraphOptions } = options;
  const out: GroupAlignment[] = [];
  for (const [index, g] of groups.entries()) {
    const enBlocks = g.en.flatMap((i) => en[i]!.blocks);
    const zhBlocks = g.zh.flatMap((i) => zh[i]!.blocks);
    if (enBlocks.length > 0 && zhBlocks.length > 0) {
      const { pairs } = await alignParagraphs(enBlocks, zhBlocks, paragraphOptions);
      out.push({ index, en: enBlocks, zh: zhBlocks, pairs });
    }
    onProgress?.(index + 1, groups.length);
  }
  return { method: options.embedder === undefined ? 'length' : 'combined', groups: out };
}

/** 一对段落，按骨架书分边。一边为空就是这段没有对应 */
export interface BlockPair {
  /** 所在组在章节表里的位置。插入时"组的开头"要用 */
  group: number;
  skeleton: Block[];
  other: Block[];
}

/** 把配对的编号换成块本身；骨架是中文时两边对调 */
export function toBlockPairs(aligned: BookAlignment, skeleton: 'en' | 'zh'): BlockPair[] {
  return aligned.groups.flatMap((g) =>
    g.pairs.map((p) => {
      const en = p.en.map((i) => g.en[i]!);
      const zh = p.zh.map((j) => g.zh[j]!);
      return skeleton === 'en'
        ? { group: g.index, skeleton: en, other: zh }
        : { group: g.index, skeleton: zh, other: en };
    }),
  );
}
