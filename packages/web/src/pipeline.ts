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

const isChinese = (l: BookLanguage) => l.kind === 'single' && l.lang.startsWith('zh');

/**
 * 合并两本书。first 排在前面，也是骨架书（1.7 再把两者分开）。
 * 哪本是英文、哪本是中文按识别出的语言定，和左右位置无关；都认不出时按位置，first 当英文
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

  // 语言检查已经排除了两本同语言、不支持的语言，剩下只有"中文 + 英文"或其中一本认不出
  const firstIsZh = isChinese(first.language);
  const [en, zh] = firstIsZh ? [second, first] : [first, second];
  const langOf = (l: BookLanguage, fallback: string) => (l.kind === 'single' ? l.lang : fallback);

  onProgress({ stage: 'chapters' });
  const { groups } = await prefillChapters(en.sections, zh.sections);
  const aligned = await alignBook(groups, en.sections, zh.sections, {
    onProgress: (done, total) => onProgress({ stage: 'paragraphs', done, total }),
  });
  onProgress({ stage: 'generating' });
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
