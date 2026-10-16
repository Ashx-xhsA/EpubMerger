export const CORE_VERSION = '0.0.0';

export { parseEpub } from './epub/parse.ts';
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
