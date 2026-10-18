export const CORE_VERSION = '0.0.0';

export {
  align,
  combinedCost,
  embeddingCost,
  lengthCost,
  meanVector,
  MOVES,
  normalCdf,
} from './align/align.ts';
export type { CostFn, EmbeddingOptions, LengthOptions, Move, Pair } from './align/align.ts';
export type { Embedder } from './align/embedder.ts';
export { cosine, normalize } from './align/vector.ts';
export {
  alignableBlocks,
  chapterSections,
  inBookOrder,
  prefillByOrder,
  validateChapterMap,
  withTitles,
} from './chapters/map.ts';
export type { ChapterGroup, ChapterMap, Section } from './chapters/map.ts';
export {
  CHAPTER_THRESHOLD,
  headAndTail,
  nonEmpty,
  pairByMeaning,
  prefillChapters,
  prefillSectionsByOrder,
  sectionVectors,
  toGroups,
} from './chapters/prefill.ts';
export type { PrefillOptions, PrefillResult } from './chapters/prefill.ts';
export { splitChapters } from './chapters/split.ts';
export type {
  Chapter,
  ChapterResult,
  ChapterSource,
  ChapterWarning,
  ChapterWarningCode,
  TocStats,
} from './chapters/types.ts';
export {
  alignParagraphs,
  isSymbolOnly,
  pairParagraphs,
  PARAGRAPH_LAMBDA,
  PARAGRAPH_THRESHOLD,
  withSymbols,
} from './paragraphs/align-paragraphs.ts';
export type {
  PairOptions,
  ParagraphAlignment,
  ParagraphOptions,
} from './paragraphs/align-paragraphs.ts';
export { alignBook, toBlockPairs } from './paragraphs/align-book.ts';
export type {
  BlockPair,
  BookAlignment,
  BookOptions,
  GroupAlignment,
} from './paragraphs/align-book.ts';
export { BILINGUAL_CSS, generateBilingual } from './generate/generate.ts';
export type {
  GenerateInput,
  GenerateReport,
  GenerateResult,
  GenerateWarningCode,
} from './generate/generate.ts';
export { findCover } from './epub/cover.ts';
export type { Cover } from './epub/cover.ts';
export { parseEpub } from './epub/parse.ts';
export { extractBlocks } from './extract/extract.ts';
export type { Block, BlockKind, ExtractResult, FileInfo, Region } from './extract/types.ts';
export { detectLanguage } from './lang/detect.ts';
export { checkLanguagePair, SUPPORTED_LANGUAGES } from './lang/pair.ts';
export type {
  BookLanguage,
  LanguageDetection,
  LanguageIssue,
  LanguageIssueCode,
  LanguagePairCheck,
  LanguageStats,
  ParagraphClass,
} from './lang/types.ts';
export type {
  Book,
  BookMetadata,
  ManifestItem,
  ParseError,
  ParseErrorCode,
  ParseResult,
  ParseWarning,
  SpineItem,
  TocEntry,
} from './epub/types.ts';
