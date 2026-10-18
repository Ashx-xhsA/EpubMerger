// 调用 core 的整条流程。不依赖 React，1.2 原样搬进 Web Worker。
// 顺序照抄 cli 的 merge：解析 → 抽块 → 切章 → 识别语言 → 章节按顺序预填 → 只按长度配段落 → 生成

import {
  alignBook,
  chapterSections,
  checkLanguagePair,
  detectLanguage,
  extractBlocks,
  generateBilingual,
  parseEpub,
  prefillChapters,
  splitChapters,
  toBlockPairs,
} from '@epubmerger/core';
import type { Book, BookLanguage, LanguageIssue, ParseErrorCode, Section } from '@epubmerger/core';

export interface LoadedBook {
  book: Book;
  sections: Section[];
  language: BookLanguage;
  title: string;
  authors: string[];
}

export type LoadResult = { ok: true; book: LoadedBook } | { ok: false; code: ParseErrorCode };

/** 读一本书：解析、抽块、切章、识别语言 */
export function loadBook(bytes: Uint8Array, fileName: string): LoadResult {
  const parsed = parseEpub(bytes);
  if (!parsed.ok) return { ok: false, code: parsed.error.code };
  const { book } = parsed;
  const blocks = extractBlocks(book).blocks;
  return {
    ok: true,
    book: {
      book,
      sections: chapterSections(splitChapters(book, blocks), blocks),
      language: detectLanguage(blocks).language,
      title: book.metadata.title || fileName.replace(/\.epub$/i, ''),
      authors: book.metadata.creators,
    },
  };
}

export type Layout = 'stacked' | 'columns';

export interface MergeStats {
  /** 配成的段落对数（两边都有段落的才算） */
  pairs: number;
  /** 插进骨架书的段落数 */
  inserted: number;
  ms: number;
}

export type MergeResult =
  | { ok: true; bytes: Uint8Array; stats: MergeStats }
  | { ok: false; issues: LanguageIssue[] }
  | { ok: false; message: string };

const isChinese = (l: BookLanguage) => l.kind === 'single' && l.lang.startsWith('zh');

/**
 * 合并两本书。first 排在前面，也是骨架书（1.7 再把两者分开）。
 * 哪本是英文、哪本是中文按识别出的语言定，和左右位置无关；都认不出时按位置，first 当英文
 */
export async function mergeBooks(
  first: LoadedBook,
  second: LoadedBook,
  options: { layout: Layout },
): Promise<MergeResult> {
  const start = performance.now();
  const check = checkLanguagePair(first.language, second.language);
  if (!check.ok) return { ok: false, issues: check.issues };

  // 语言检查已经排除了两本同语言、不支持的语言，剩下只有"中文 + 英文"或其中一本认不出
  const firstIsZh = isChinese(first.language);
  const [en, zh] = firstIsZh ? [second, first] : [first, second];
  const langOf = (l: BookLanguage, fallback: string) => (l.kind === 'single' ? l.lang : fallback);

  const { groups } = await prefillChapters(en.sections, zh.sections);
  const aligned = await alignBook(groups, en.sections, zh.sections);
  const skeleton = firstIsZh ? 'zh' : 'en';
  const pairs = toBlockPairs(aligned, skeleton);
  const result = generateBilingual({
    skeleton: first.book,
    skeletonLang: langOf(first.language, firstIsZh ? 'zh-Hans' : 'en'),
    otherLang: langOf(second.language, firstIsZh ? 'en' : 'zh-Hans'),
    pairs,
    otherFirst: false,
    layout: options.layout,
    title: `${first.title} / ${second.title}`,
  });
  if (!result.ok) return { ok: false, message: result.message };
  return {
    ok: true,
    bytes: result.bytes,
    stats: {
      pairs: pairs.filter((p) => p.skeleton.length > 0 && p.other.length > 0).length,
      inserted: result.report.inserted,
      ms: performance.now() - start,
    },
  };
}
