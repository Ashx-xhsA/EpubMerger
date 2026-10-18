import type { Strings } from './en.ts';

export const zh: Strings = {
  htmlLang: 'zh-Hans',
  tagline: '把同一本书的两个语言版本，合成一本双语 ePub',
  privacy: '文件只在你的浏览器里处理，不会上传',

  slotFirst: '排在前面',
  slotSecond: '排在后面',
  bookFallback: (n: number) => `第 ${n} 本`,
  dropHint: '拖进来，或点击选择',
  dropSub: '.epub 文件，无 DRM',
  reading: '读取中…',
  remove: '移除',
  swap: '交换',
  swapLabel: '交换顺序',
  parseError: (code: string) => `这个文件用不了（${code}）`,
  languageUnclear: '语言不确定',
  languageNames: {
    en: '英文',
    'zh-Hans': '简体中文',
    'zh-Hant': '繁体中文',
    ja: '日文',
    ko: '韩文',
    fr: '法文',
    de: '德文',
    es: '西班牙文',
    ru: '俄文',
  },

  layout: '排版',
  stacked: '上下交替',
  stackedCaption: (a: string, b: string) => `${a}在前，${b}在后`,
  columns: '左右两栏',
  columnsCaption: (a: string) => `${a}在左 · 适合平板和电脑`,

  start: '开始合并',
  merging: '合并中…',
  sameBookReminder: '请确认两本是同一本书的两个语言版本',
  needBothBooks: '先放入两本书',
  mergeIssue: {
    SAME_LANGUAGE: (lang: string) => `两本都是${lang}。请放入一本英文、一本中文。`,
    UNSUPPORTED_LANGUAGE: (lang: string) => `暂不支持${lang}，目前只支持英文和简体中文。`,
    LANGUAGE_UNCERTAIN: () => '有一本书认不出是什么语言。',
  },
  mergeFailed: (message: string) => `合并失败：${message}`,
  done: (pairs: number, secs: string) => `配成 ${pairs} 对段落，用时 ${secs} 秒`,
  download: '下载双语 ePub',

  tipsTitle: '这样的书效果最好',
  tips: [
    '有完整的目录',
    '图片、图表少，小说和散文最好',
    '两本是同一个版本，不是删节版或改编版',
    '没有 DRM 保护',
  ],

  footerPrivacy: '隐私说明',
  footerPersonalUse: '仅限个人使用',
};
