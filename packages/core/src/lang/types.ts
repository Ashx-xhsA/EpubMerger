/** 一段文字里各种"单位"的个数。汉字、假名、谚文按字数；用空格分词的文字按词数 */
export interface UnitCounts {
  han: number;
  kana: number;
  hangul: number;
  latin: number;
  cyrillic: number;
  /** 其他字母文字的词（希腊文、阿拉伯文……） */
  other: number;
}

/**
 * 一段的判定：
 * - zh / ja / ko：中日韩段，汉字 + 假名 + 谚文占多数
 * - latin / cyrillic / other：几乎全是这种字母文字的段，具体语言由全书判定时再认
 * - mixed：两类都不少，不投票
 * - short：太短，不投票
 */
export type ParagraphClass =
  'zh' | 'ja' | 'ko' | 'latin' | 'cyrillic' | 'other' | 'mixed' | 'short';

/**
 * 一本书的语言。语言用 BCP 47 代码（en、zh-Hans、zh-Hant、ja、fr……），也就是 ePub 里
 * lang / xml:lang 要填的值；franc 认得但换算表里没有的语言保留它的三字母代码
 */
export type BookLanguage =
  | { kind: 'single'; lang: string }
  /** 没有一种语言占绝对多数，包括已经是双语的书 */
  | { kind: 'uncertain' };

/** 判定用到的统计数字，CLI 和统计页用 */
export interface LanguageStats {
  /** 参与判定的段落按 ParagraphClass 分的个数 */
  paragraphs: Record<ParagraphClass, number>;
  /** 每种语言估计有多少段（字母文字的段按抽样比例分给各语言） */
  languages: Record<string, number>;
  /** 中文段里繁体专用字、简体专用字的总数 */
  variants: { traditional: number; simplified: number };
  /** 每种字母文字抽样交给 franc 的结果：文字 → 语言 → 段数 */
  samples: Record<string, Record<string, number>>;
}

export interface LanguageDetection {
  language: BookLanguage;
  stats: LanguageStats;
}

/** 两本书语言组合的问题。提示文案由界面按 code 查表，core 里不放 */
export type LanguageIssueCode = 'LANGUAGE_UNCERTAIN' | 'SAME_LANGUAGE' | 'UNSUPPORTED_LANGUAGE';

export interface LanguageIssue {
  /** error 要拦下，warning 只提醒 */
  level: 'error' | 'warning';
  code: LanguageIssueCode;
  /** 问题挂在哪本书上；SAME_LANGUAGE 是两本一起 */
  bookSide: 'a' | 'b' | 'both';
  /** 识别出的语言，UNSUPPORTED_LANGUAGE 和 SAME_LANGUAGE 时有，界面用它说"这本书是繁体中文" */
  lang?: string;
}

export interface LanguagePairCheck {
  /** 没有 error 时为 true（只有警告也算） */
  ok: boolean;
  issues: LanguageIssue[];
}
