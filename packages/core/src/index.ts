export const CORE_VERSION = '0.0.0';

export { splitChapters } from './chapters/split.ts';
export type {
  Chapter,
  ChapterResult,
  ChapterSource,
  ChapterWarning,
  ChapterWarningCode,
  TocStats,
} from './chapters/types.ts';
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
