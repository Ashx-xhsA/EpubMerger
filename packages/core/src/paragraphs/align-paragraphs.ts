import { align, combinedCost, embeddingCost, lengthCost, type Pair } from '../align/align.ts';
import type { Embedder } from '../align/embedder.ts';
import type { Block } from '../extract/types.ts';

/**
 * 段落配对：在用户确认过的一组章节里，把英文块和中文块配成一对一对。
 * 有模型时用"长度 + λ × 意思"的合并代价（trade-off 017），没有时只用长度。
 * 结果里两边每个块恰好出现一次，按书里的顺序排，生成 ePub 时不丢内容
 */

/** 按意思的门槛（0.4b 定的，0.4a 在新书上验证过） */
export const PARAGRAPH_THRESHOLD = 0.75;
/** 合并代价里意思代价的权重 */
export const PARAGRAPH_LAMBDA = 200;

/** 一个字母、数字、汉字都没有的块（"—""◆◆◆◆""* * *"）。它们不参与配对，配完放回原位 */
export function isSymbolOnly(b: Block): boolean {
  return !/[\p{L}\p{N}]/u.test(b.text);
}

/** 字数：去掉空白后的字符数，长度代价用 */
function chars(b: Block): number {
  return b.text.replace(/\s/g, '').length;
}

export interface PairOptions {
  threshold?: number;
  lambda?: number;
}

/**
 * 配对的计算部分：给了向量（和 en、zh 一一对应）就用合并代价，没给就只用长度。
 * 输入里不应该有只有符号的块，alignParagraphs 会先把它们拿出来
 */
export function pairParagraphs(
  en: Block[],
  zh: Block[],
  vectors?: { en: Float32Array[]; zh: Float32Array[] },
  options: PairOptions = {},
): Pair[] {
  const lengths = { en: en.map(chars), zh: zh.map(chars) };
  const length = lengthCost(lengths.en, lengths.zh);
  if (vectors === undefined) return align(en.length, zh.length, length);
  const meaning = embeddingCost(vectors.en, vectors.zh, {
    threshold: options.threshold ?? PARAGRAPH_THRESHOLD,
    lengths,
  });
  return align(
    en.length,
    zh.length,
    combinedCost(length, meaning, options.lambda ?? PARAGRAPH_LAMBDA),
  );
}

export interface ParagraphOptions extends PairOptions {
  /** 不给时只按长度配 */
  embedder?: Embedder;
}

export interface ParagraphAlignment {
  method: 'combined' | 'length';
  /** 编号是输入的 en、zh 里的位置。一边为空就是这段没有对应 */
  pairs: Pair[];
}

/** 一组章节的段落配对：拿出符号块，配对，把编号换回原来的块，再把符号块插回原位 */
export async function alignParagraphs(
  en: Block[],
  zh: Block[],
  options: ParagraphOptions = {},
): Promise<ParagraphAlignment> {
  const keep = (blocks: Block[]) => blocks.flatMap((b, i) => (isSymbolOnly(b) ? [] : [i]));
  const enIds = keep(en);
  const zhIds = keep(zh);
  const enKept = enIds.map((i) => en[i]!);
  const zhKept = zhIds.map((j) => zh[j]!);

  const { embedder } = options;
  let vectors: { en: Float32Array[]; zh: Float32Array[] } | undefined;
  if (embedder !== undefined) {
    const all = await embedder.embed([...enKept, ...zhKept].map((b) => b.text));
    vectors = { en: all.slice(0, enKept.length), zh: all.slice(enKept.length) };
  }

  const pairs = pairParagraphs(enKept, zhKept, vectors, options).map((p) => ({
    en: p.en.map((i) => enIds[i]!),
    zh: p.zh.map((j) => zhIds[j]!),
  }));
  return {
    method: embedder === undefined ? 'length' : 'combined',
    pairs: withSymbols(pairs, en, zh),
  };
}

/**
 * 把符号块插回去：英文第 k 块是符号，就放在第一对用到英文 k 之后的块的前面（中文同理），
 * 各自成一项、另一边为空。配对本身是按顺序往前走的，所以这样排出来就是书里的顺序
 */
export function withSymbols(pairs: Pair[], en: Block[], zh: Block[]): Pair[] {
  const symbols = (blocks: Block[]) => blocks.flatMap((b, i) => (isSymbolOnly(b) ? [i] : []));
  const enSym = symbols(en);
  const zhSym = symbols(zh);
  const out: Pair[] = [];
  const flush = (enBefore: number, zhBefore: number) => {
    while (enSym.length > 0 && enSym[0]! < enBefore) out.push({ en: [enSym.shift()!], zh: [] });
    while (zhSym.length > 0 && zhSym[0]! < zhBefore) out.push({ en: [], zh: [zhSym.shift()!] });
  };
  for (const p of pairs) {
    flush(p.en[0] ?? -1, p.zh[0] ?? -1);
    out.push(p);
  }
  flush(Infinity, Infinity);
  return out;
}
