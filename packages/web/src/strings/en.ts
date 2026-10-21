// 界面上所有给人看的文字。zh.ts 的类型就是这里的类型，漏翻一条 TypeScript 就报错

import type { ChapterWarningCode, LanguageIssueCode, ParseErrorCode } from '@epubmerger/core';
import { legalEn } from './legal-en.ts';

/** 读书失败的原因。UNEXPECTED 是 Worker 里抛出了意外的错误，不是 core 的错误码 */
export type LoadErrorCode = ParseErrorCode | 'UNEXPECTED';

interface LanguageIssueText {
  /** 卡片上语言标签里的短说明 */
  label: (lang: string) => string;
  /** 按钮上方提示框里的完整说明 */
  detail: (lang: string, title: string) => string;
}

export const en = {
  htmlLang: 'en',
  tagline: 'Merge two language editions of the same book into one ePub file',
  privacy: 'Your files never leave your browser',

  slotFirst: 'Shown first',
  slotSecond: 'Shown second',
  slotLeft: 'Shown on the left',
  slotRight: 'Shown on the right',
  bookFallback: (n: number) => `Book ${n}`,
  dropHint: 'Drop an .epub here, or click to choose',
  dropSub: 'DRM-free .epub',
  reading: 'Reading…',
  remove: 'Remove',
  swap: 'Swap',
  swapLabel: 'Swap order',
  parseErrors: {
    NOT_EPUB: { title: 'Not a valid ePub', hint: "Make sure it isn't a renamed PDF or zip" },
    CORRUPTED: { title: 'This file is damaged', hint: 'Try converting it again with Calibre' },
    DRM_PROTECTED: { title: 'Protected by DRM', hint: 'Only DRM-free books can be used' },
    FIXED_LAYOUT: {
      title: 'Fixed-layout book',
      hint: "Books laid out like PDFs aren't supported yet",
    },
    NO_TEXT: { title: 'Almost no text', hint: 'Probably scanned pages; nothing to pair up' },
    TOO_LARGE: { title: 'File too large', hint: 'The limit is 100 MB' },
    VERTICAL_LAYOUT: {
      title: 'Vertical layout',
      hint: 'Not supported yet; try a horizontal edition',
    },
    UNEXPECTED: {
      title: 'Something went wrong reading this file',
      hint: 'Try another copy of the book',
    },
  } as Record<LoadErrorCode, { title: string; hint: string }>,
  languageUnclear: 'Language unclear',
  languageNames: {
    en: 'English',
    'zh-Hans': 'Chinese (Simplified)',
    'zh-Hant': 'Chinese (Traditional)',
    ja: 'Japanese',
    ko: 'Korean',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
    it: 'Italian',
    pt: 'Portuguese',
    ru: 'Russian',
    ar: 'Arabic',
    he: 'Hebrew',
    fa: 'Persian',
    ur: 'Urdu',
  } as Record<string, string>,

  layout: 'Layout',
  stacked: 'Stacked',
  stackedCaption: (a: string, b: string) => `${a}, then ${b}`,
  columns: 'Side by side',
  columnsCaption: (a: string) => `${a} left · best on tablets`,

  start: 'Start merging',
  merging: 'Merging…',
  progress: {
    reading: 'Reading the books…',
    paragraphs: (done: number, total: number) => `Matching paragraphs ${done}/${total}…`,
    generating: 'Building the ePub…',
  },
  cancel: 'Cancel',
  cancelled: 'Cancelled',
  sameBookReminder: 'Make sure both files are the same book in two languages',
  needBothBooks: 'Add both books first',
  languageIssues: {
    SAME_LANGUAGE: {
      label: (lang) => `${lang} · same as the other`,
      detail: (lang) =>
        `Both books are in ${lang}. Use two editions of the book in different languages.`,
    },
    UNSUPPORTED_LANGUAGE: {
      label: (lang) => `${lang} · not supported`,
      detail: (lang, title) =>
        `“${title}” is in ${lang}. Right-to-left scripts aren't supported yet.`,
    },
    UNTESTED_LANGUAGE: {
      label: (lang) => `${lang} · untested`,
      detail: (lang, title) =>
        `“${title}” is in ${lang}. We've only tested with English and Simplified Chinese books; other languages should work, but results aren't verified.`,
    },
    LANGUAGE_UNCERTAIN: {
      label: () => 'Language unclear',
      detail: (_lang, title) =>
        `Couldn't tell what language “${title}” is in. It may already be bilingual, or have little text. You can continue if it looks right.`,
    },
  } as Record<LanguageIssueCode, LanguageIssueText>,
  continueAnyway: 'Continue anyway',

  tocTag: {
    TOC_MISSING: 'No usable contents',
    TOC_UNRELIABLE: 'Incomplete contents',
  } as Record<ChapterWarningCode, string>,
  tocNotice: {
    TOC_MISSING: (title: string, count: number) =>
      count === 1
        ? `“${title}” has no usable table of contents. Matching will be less accurate; an edition with a table of contents works better.`
        : `“${title}” has no usable table of contents, so it was split by file into ${count} sections. Matching will be less accurate; an edition with a table of contents works better.`,
    TOC_UNRELIABLE: (title: string, count: number) =>
      count === 1
        ? `The table of contents of “${title}” is incomplete. Matching will be less accurate; an edition with a complete table of contents works better.`
        : `The table of contents of “${title}” is incomplete, so it was split by file into ${count} sections. Matching will be less accurate; an edition with a complete table of contents works better.`,
  } as Record<ChapterWarningCode, (title: string, count: number) => string>,

  range: {
    title: 'Step 1 · Where does the main text start and end?',
    hint: 'We guessed where the main text starts and ends — please check it and fix anything that’s wrong. Sections outside the main text (copyright, contents, acknowledgements…) won’t be merged.',
    start: 'Start',
    end: 'End',
    outside: 'not merged',
    gap: (n: number) => `${n} more ${n === 1 ? 'section' : 'sections'} in between`,
    collapseGap: 'Fold the middle',
    restore: 'Back to our guess',
    next: 'Next: check chapter matching',
  },

  chapters: {
    title: 'Step 2 · Chapter matching',
    rangeLine: (first: string, second: string) => `Main text: ${first}  ↔  ${second}`,
    rangeSpan: (start: string, end: string) =>
      start === end ? `“${start}”` : `“${start}” – “${end}”`,
    editRange: 'Change',
    refilled: 'Matched the chapters again for the new main-text range.',
    hint: 'Within the main text we matched the chapters by length — please check before merging. Blue sections are matched with the one beside them.\nGrey dashed ones are unmatched: the left book is the base book, so its chapters stay in the merged book even when unmatched. Unmatched chapters on the right are dropped from the result.',
    preparing: 'Sorting out the chapters…',
    prepareFailed: (message: string) => `Couldn't read the chapters: ${message}`,
    restore: 'Reset',
    collapse: 'Hide',
    expand: 'Show',
    originalOnly: 'original only',
    leftOut: 'left out',
    chars: (n: number) => `${n.toLocaleString('en')} chars`,
    emptySection: 'no text',
    showEmpty: (n: number) => `Show ${n} ${n === 1 ? 'section' : 'sections'} without text`,
    hideEmpty: 'Hide sections without text',
    idle: 'To change a match, click a section on one side, then its match on the other. Click × in the middle to split a pair.',
    selected: (title: string, isFirst: boolean) =>
      `Selected “${title}”. Now click its match on the ${isFirst ? 'right' : 'left'}, or click it again to cancel.`,
    paired: (a: string, b: string, dropped: number) =>
      `Matched “${a}” ↔ “${b}”.${dropped > 0 ? ` Removed ${dropped} conflicting ${dropped === 1 ? 'match' : 'matches'}.` : ''}`,
    unpaired: 'Split apart; both sides are now left out.',
    undo: 'Undo',
    unpair: 'Split this pair',
    problems:
      'The groups in red cross over or have a gap: sections on both sides must be consecutive and go down in order. Fix them before merging.',
  },
  mergeFailed: (message: string) => `Merge failed: ${message}`,
  done: (pairs: number, secs: string) => `Matched ${pairs} paragraph pairs in ${secs} s`,
  download: 'Download bilingual ePub',

  tipsTitle: 'Works best with books that',
  tips: [
    'have a complete table of contents',
    'have few images or charts',
    'are the same edition in both languages, not abridged',
    'are DRM-free',
    'are in English and Simplified Chinese, the pair I’ve tested — other languages are worth a try too, and feedback is welcome!',
  ],

  footerPrivacy: 'Privacy',
  footerTerms: 'Terms',
  footerIssues: 'Report a problem',

  legal: legalEn,
};

export type Strings = typeof en;
