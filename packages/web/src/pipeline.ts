// 调用 core 的整条流程，只在 Web Worker 里跑（worker.ts）。不依赖 React。
// 顺序照抄 cli 的 merge：解析 → 抽块 → 切章 → 识别语言 → 章节表（prepareChapters 按长度预填，
// 用户在界面上确认后传回 mergeBooks）→ 只按长度配段落 → 生成
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
  sectionChars,
  splitChapters,
  toBlockPairs,
  validateChapterMap,
} from '@epubmerger/core';
import type {
  Book,
  BookLanguage,
  ChapterGroup,
  ChapterResult,
  ChapterSource,
  ChapterWarningCode,
  LanguageIssue,
  ParseErrorCode,
  Section,
} from '@epubmerger/core';

/** 传回主线程的书的信息，只有界面要显示的几项 */
export interface BookSummary {
  title: string;
  authors: string[];
  language: BookLanguage;
  /** 封面图片的字节，没有封面时是 null */
  cover: { bytes: Uint8Array; mediaType: string } | null;
  /** 章节是怎么切的，目录不能用时卡片和章节表上方要提示 */
  chapters: {
    source: ChapterSource;
    /** 有正文的节数 */
    count: number;
    warning: ChapterWarningCode | null;
  };
}

interface LoadedBook extends Omit<BookSummary, 'cover' | 'chapters'> {
  book: Book;
  chapters: ChapterResult;
  sections: Section[];
}

type ReadResult = { ok: true; book: LoadedBook } | { ok: false; code: ParseErrorCode };

/** 读一本书：解析、抽块、切章、识别语言 */
function readBook(bytes: Uint8Array, fileName: string): ReadResult {
  const parsed = parseEpub(bytes);
  if (!parsed.ok) return { ok: false, code: parsed.error.code };
  const { book } = parsed;
  const blocks = extractBlocks(book).blocks;
  const chapters = splitChapters(book, blocks);
  return {
    ok: true,
    book: {
      book,
      chapters,
      sections: chapterSections(chapters, blocks),
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
  const { book, title, authors, language, chapters, sections } = read.book;
  const found = findCover(book);
  const coverBytes = found === null ? null : book.readBytes(found.path);
  const cover =
    found === null || coverBytes === null
      ? null
      : // 复制一份：Worker 会把它交给主线程（transfer），不碰书里原来的数据
        { bytes: coverBytes.slice(), mediaType: found.mediaType };
  const summary: BookSummary = {
    title,
    authors,
    language,
    cover,
    chapters: {
      source: chapters.source,
      count: sections.filter((s) => s.blocks.length > 0).length,
      warning: chapters.warnings[0]?.code ?? null,
    },
  };
  return { ok: true, summary };
}

export interface BookInput {
  bytes: Uint8Array;
  fileName: string;
}

/** 章节表里一节要显示的东西。只传这些小数据，不传正文 */
export interface SectionInfo {
  title: string;
  /** 目录里的层级，0 是最外层 */
  depth: number;
  /** 字数，不算空白 */
  chars: number;
  /** 正文的开头，帮用户认出是哪一节 */
  preview: string;
  /** 没有参与配对的正文（只有图片、扉页之类），不能配对 */
  empty: boolean;
}

export interface PreparedChapters {
  first: SectionInfo[];
  second: SectionInfo[];
  /** 按长度预填的章节表，en 一侧是第一本 */
  groups: ChapterGroup[];
}

export type PrepareResult =
  { ok: true; chapters: PreparedChapters } | { ok: false; message: string };

const PREVIEW_CHARS = 80;

/** 第一个不只是重复节名的块：跳过标题，以及"PART 1"这种写在普通段落里、已经包含在节名里的字 */
function previewOf(s: Section): string {
  const title = s.title.toLowerCase();
  const block =
    s.blocks.find((b) => b.kind !== 'heading' && !title.includes(b.text.trim().toLowerCase())) ??
    s.blocks[0];
  return block?.text.slice(0, PREVIEW_CHARS) ?? '';
}

const sectionInfo = (s: Section): SectionInfo => ({
  title: s.title,
  depth: s.depth,
  chars: sectionChars(s),
  preview: previewOf(s),
  empty: s.blocks.length === 0,
});

/** 两本都读好后调用：给章节表准备两本的节列表和预填 */
export async function prepareChapters(
  firstInput: BookInput,
  secondInput: BookInput,
): Promise<PrepareResult> {
  const firstRead = readBook(firstInput.bytes, firstInput.fileName);
  const secondRead = readBook(secondInput.bytes, secondInput.fileName);
  if (!firstRead.ok) return { ok: false, message: firstRead.code };
  if (!secondRead.ok) return { ok: false, message: secondRead.code };
  const [first, second] = [firstRead.book.sections, secondRead.book.sections];
  // 网页里没有向量模型（Phase 2 才接），按长度预填（trade-off 032）
  const { groups } = await prefillChapters(first, second, { fallback: 'length' });
  return {
    ok: true,
    chapters: { first: first.map(sectionInfo), second: second.map(sectionInfo), groups },
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

export type MergeProgress =
  { stage: 'reading' | 'generating' } | { stage: 'paragraphs'; done: number; total: number };

export type MergeResult =
  | { ok: true; bytes: Uint8Array; stats: MergeStats }
  | { ok: false; issues: LanguageIssue[] }
  | { ok: false; message: string };

/** 认不出语言时 lang 属性填 und（BCP 47 的"未知语言"） */
const langOf = (l: BookLanguage) => (l.kind === 'single' ? l.lang : 'und');

/**
 * 合并两本书。first 排在前面，也是骨架书（1.7 再把两者分开）。
 * 语言检查有 error 时不合并；只有警告时照常合并（界面已经让用户点过"仍然继续"）。
 * groups 是用户确认过的章节表（en 一侧是第一本）。节号和 prepareChapters 算出来的一样：同一份文件、同一套代码
 */
export async function mergeBooks(
  firstInput: BookInput,
  secondInput: BookInput,
  options: { layout: Layout; groups: ChapterGroup[] },
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

  // 正常情况下界面已经拦住了有问题的表，这里只是兜底
  if (validateChapterMap(options.groups, en.sections.length, zh.sections.length).length > 0) {
    return { ok: false, message: 'CHAPTER_MAP_INVALID' };
  }
  const aligned = await alignBook(options.groups, en.sections, zh.sections, {
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
