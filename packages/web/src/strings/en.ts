// 界面上所有给人看的文字。zh.ts 的类型就是这里的类型，漏翻一条 TypeScript 就报错

export const en = {
  htmlLang: 'en',
  tagline: 'Merge two language editions of the same book into one bilingual ePub',
  privacy: 'Your files never leave your browser',

  slotFirst: 'Shown first',
  slotSecond: 'Shown second',
  bookFallback: (n: number) => `Book ${n}`,
  dropHint: 'Drop an .epub here, or click to choose',
  dropSub: 'DRM-free .epub',
  reading: 'Reading…',
  remove: 'Remove',
  swap: 'Swap',
  swapLabel: 'Swap order',
  parseError: (code: string) => `Can't use this file (${code})`,
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
    ru: 'Russian',
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
  mergeIssue: {
    SAME_LANGUAGE: (lang: string) =>
      `Both books are in ${lang}. Add one English and one Chinese book.`,
    UNSUPPORTED_LANGUAGE: (lang: string) =>
      `${lang} isn't supported yet. Only English and Chinese (Simplified) work for now.`,
    LANGUAGE_UNCERTAIN: () => "Couldn't tell the language of one book.",
  },
  mergeFailed: (message: string) => `Merge failed: ${message}`,
  done: (pairs: number, secs: string) => `Matched ${pairs} paragraph pairs in ${secs} s`,
  download: 'Download bilingual ePub',

  tipsTitle: 'Works best with books that',
  tips: [
    'have a complete table of contents',
    'have few images or charts — novels and essays are ideal',
    'are the same edition in both languages, not abridged or adapted',
    'are DRM-free',
  ],

  footerPrivacy: 'Privacy',
  footerPersonalUse: 'Personal use only',
};

export type Strings = typeof en;
