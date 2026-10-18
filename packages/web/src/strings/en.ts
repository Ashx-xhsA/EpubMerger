// 界面上所有给人看的文字。zh.ts 的类型就是这里的类型，漏翻一条 TypeScript 就报错

import type { LanguageIssueCode, ParseErrorCode } from '@epubmerger/core';

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
  tagline: 'Merge two language editions of the same book into one bilingual ePub',
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
    chapters: 'Matching chapters…',
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
  mergeFailed: (message: string) => `Merge failed: ${message}`,
  done: (pairs: number, secs: string) => `Matched ${pairs} paragraph pairs in ${secs} s`,
  download: 'Download bilingual ePub',

  tipsTitle: 'Works best with books that',
  tips: [
    'have a complete table of contents',
    'have few images or charts — novels and essays are ideal',
    'are the same edition in both languages, not abridged or adapted',
    'are DRM-free',
    'are in English and Simplified Chinese — other languages work too, but are untested',
  ],

  footerPrivacy: 'Privacy',
  footerPersonalUse: 'Personal use only',
};

export type Strings = typeof en;
