// 调用 core 的整条流程，只在 Web Worker 里跑（worker.ts）。不依赖 React。
// 顺序照抄 cli 的 merge：解析 → 抽块 → 切章 → 识别语言 → 章节按顺序预填 → 只按长度配段落 → 生成
// Worker 不保存书：主线程留着文件字节，合并时再传一次、重新解析（取消 = 杀掉 Worker，见 worker-client.ts）

import {
  alignBook,
  chapterSections,
  checkLanguagePair,
  detectLanguage,
  extractBlocks,
  findCover,
  generateBilingual,
  parseEpub,
  prefillChapters,
  splitChapters,
  toBlockPairs,
} from '@epubmerger/core';
import type { Book, BookLanguage, LanguageIssue, ParseErrorCode, Section } from '@epubmerger/core';

/** 传回主线程的书的信息，只有界面要显示的几项 */
export interface BookSummary {
  title: string;
  authors: string[];
  language: BookLanguage;
  /** 封面图片的字节，没有封面时是 null */
  cover: { bytes: Uint8Array; mediaType: string } | null;
}

interface LoadedBook extends Omit<BookSummary, 'cover'> {
  book: Book;
  sections: Section[];
}

type ReadResult = { ok: true; book: LoadedBook } | { ok: false; code: ParseErrorCode };

/** 读一本书：解析、抽块、切章、识别语言 */
function readBook(bytes: Uint8Array, fileName: string): ReadResult {
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

export type LoadResult = { ok: true; summary: BookSummary } | { ok: false; code: ParseErrorCode };

/** 上传时调用：读一遍，只把摘要传回去 */
export function loadBook(bytes: Uint8Array, fileName: string): LoadResult {
  const read = readBook(bytes, fileName);
  if (!read.ok) return read;
  const { book, title, authors, language } = read.book;
  const found = findCover(book);
  const coverBytes = found === null ? null : book.readBytes(found.path);
  const cover =
    found === null || coverBytes === null
      ? null
      : // 复制一份：Worker 会把它交给主线程（transfer），不碰书里原来的数据
        { bytes: coverBytes.slice(), mediaType: found.mediaType };
  return { ok: true, summary: { title, authors, language, cover } };
}

export interface BookInput {
  bytes: Uint8Array;
  fileName: string;
}

export type Layout = 'stacked' | 'columns';

export interface MergeStats {
  /** 配成的段落对数（两边都有段落的才算） */
  pairs: number;
  /** 插进骨架书的段落数 */
  inserted: number;
  ms: number;
}

export type MergeProgress =
  | { stage: 'reading' | 'chapters' | 'generating' }
  | { stage: 'paragraphs'; done: number; total: number };

export type MergeResult =
  | { ok: true; bytes: Uint8Array; stats: MergeStats }
  | { ok: false; issues: LanguageIssue[] }
  | { ok: false; message: string };

/** 认不出语言时 lang 属性填 und（BCP 47 的"未知语言"） */
const langOf = (l: BookLanguage) => (l.kind === 'single' ? l.lang : 'und');

/**
 * 合并两本书。first 排在前面，也是骨架书（1.7 再把两者分开）。
 * 语言检查有 error 时不合并；只有警告时照常合并（界面已经让用户点过"仍然继续"）
 */
export async function mergeBooks(
  firstInput: BookInput,
  secondInput: BookInput,
  options: { layout: Layout },
  onProgress: (progress: MergeProgress) => void = () => {},
): Promise<MergeResult> {
  const start = performance.now();
  onProgress({ stage: 'reading' });
  // 上传时已经读成功过，这里一般不会失败
  const firstRead = readBook(firstInput.bytes, firstInput.fileName);
  const secondRead = readBook(secondInput.bytes, secondInput.fileName);
  if (!firstRead.ok) return { ok: false, message: firstRead.code };
  if (!secondRead.ok) return { ok: false, message: secondRead.code };
  const [first, second] = [firstRead.book, secondRead.book];
  const check = checkLanguagePair(first.language, second.language);
  if (!check.ok) return { ok: false, issues: check.issues };

  // core 的参数叫 en / zh，其实只代表"第一本 / 第二本"：长度比例按两本书自己算，不挑语言。
  // 这里按位置传，first 进 en 那一侧。长度代价不完全对称，两本对调后个别段落的配法会不同；
  // 0.9 的 96.5% 是英文在 en 一侧测的，中文排在前面时没测过（2026-10-18 决定仍按位置）
  const [en, zh] = [first, second];

  onProgress({ stage: 'chapters' });
  const { groups } = await prefillChapters(en.sections, zh.sections);
  const aligned = await alignBook(groups, en.sections, zh.sections, {
    onProgress: (done, total) => onProgress({ stage: 'paragraphs', done, total }),
  });
  onProgress({ stage: 'generating' });
  const pairs = toBlockPairs(aligned, 'en');
  const result = generateBilingual({
    skeleton: first.book,
    skeletonLang: langOf(first.language),
    otherLang: langOf(second.language),
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
