export const CORE_VERSION = '0.0.0';

export { parseEpub } from './epub/parse.ts';
export { extractBlocks } from './extract/extract.ts';
export type { Block, BlockKind, ExtractResult, FileInfo, Region } from './extract/types.ts';
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
