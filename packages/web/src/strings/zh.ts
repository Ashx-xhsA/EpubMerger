import type { Strings } from './en.ts';

export const zh: Strings = {
  htmlLang: 'zh-Hans',
  tagline: '把同一本书的两个语言版本，合成一本双语 ePub',
  privacy: '文件只在你的浏览器里处理，不会上传',

  slotFirst: '排在前面',
  slotSecond: '排在后面',
  slotLeft: '排在左边',
  slotRight: '排在右边',
  bookFallback: (n: number) => `第 ${n} 本`,
  dropHint: '拖进来，或点击选择',
  dropSub: '.epub 文件，无 DRM',
  reading: '读取中…',
  remove: '移除',
  swap: '交换',
  swapLabel: '交换顺序',
  parseErrors: {
    NOT_EPUB: { title: '不是有效的 ePub', hint: '请确认文件不是改了后缀的 PDF 或压缩包' },
    CORRUPTED: { title: '文件已损坏', hint: '可以用 Calibre 重新转换一次再试' },
    DRM_PROTECTED: { title: '有版权保护（DRM）', hint: '只能处理没有 DRM 的书' },
    FIXED_LAYOUT: { title: '固定版式的书', hint: '这类书像 PDF 一样排好了版，暂不支持' },
    NO_TEXT: { title: '几乎没有文字', hint: '可能是扫描版，没法逐段对照' },
    TOO_LARGE: { title: '文件太大', hint: '目前最大 100 MB' },
    VERTICAL_LAYOUT: { title: '竖排的书', hint: '暂不支持，请换横排的版本' },
    UNEXPECTED: { title: '读取时出了意外的错误', hint: '换一个版本的文件试试' },
  },
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
    it: '意大利文',
    pt: '葡萄牙文',
    ru: '俄文',
    ar: '阿拉伯文',
    he: '希伯来文',
    fa: '波斯文',
    ur: '乌尔都文',
  },

  layout: '排版',
  stacked: '上下交替',
  stackedCaption: (a: string, b: string) => `${a}在前，${b}在后`,
  columns: '左右两栏',
  columnsCaption: (a: string) => `${a}在左 · 适合平板和电脑`,

  start: '开始合并',
  merging: '合并中…',
  progress: {
    reading: '正在读取…',
    paragraphs: (done, total) => `正在配对段落 ${done}/${total}…`,
    generating: '正在生成…',
  },
  cancel: '取消',
  cancelled: '已取消',
  sameBookReminder: '请确认两本是同一本书的两个语言版本',
  needBothBooks: '先放入两本书',
  languageIssues: {
    SAME_LANGUAGE: {
      label: (lang) => `${lang} · 两本相同`,
      detail: (lang) => `两本都是${lang}。请放入同一本书的两个不同语言的版本。`,
    },
    UNSUPPORTED_LANGUAGE: {
      label: (lang) => `${lang} · 暂不支持`,
      detail: (lang, title) => `《${title}》是${lang}。从右往左书写的文字暂不支持。`,
    },
    UNTESTED_LANGUAGE: {
      label: (lang) => `${lang} · 未测试`,
      detail: (lang, title) =>
        `《${title}》是${lang}。目前只用英文和简体中文的书测试过，其他语言也可以合并，但效果没有验证过。`,
    },
    LANGUAGE_UNCERTAIN: {
      label: () => '语言不确定',
      detail: (_lang, title) =>
        `认不出《${title}》的语言，可能已经是双语书，或者正文很少。确认没问题可以继续。`,
    },
  },
  continueAnyway: '仍然继续',

  tocTag: {
    TOC_MISSING: '没有可用目录',
    TOC_UNRELIABLE: '目录不完整',
  },
  tocNotice: {
    TOC_MISSING: (title, count) =>
      count === 1
        ? `《${title}》没有可用的目录，整本书当成了一节，对齐会不太准。最好换一个带目录的版本。`
        : `《${title}》没有可用的目录，已按文件分成 ${count} 节，对齐会不太准。最好换一个带目录的版本。`,
    TOC_UNRELIABLE: (title, count) =>
      count === 1
        ? `《${title}》的目录不完整，整本书当成了一节，对齐会不太准。最好换一个目录完整的版本。`
        : `《${title}》的目录不完整，已按文件分成 ${count} 节，对齐会不太准。最好换一个目录完整的版本。`,
  },

  range: {
    title: '第一步 · 正文从哪里开始、到哪里结束？',
    hint: '我们先猜了一下，请两本书都看一眼。首尾之外的节（版权页、目录、致谢、下一本的试读……）不会合并。',
    start: '开头',
    end: '结尾',
    outside: '不合并',
    gap: (n) => `中间还有 ${n} 节`,
    collapseGap: '收起中间',
    restore: '恢复我们猜的',
    next: '下一步：检查章节配对',
  },

  chapters: {
    title: '第二步 · 章节对照表',
    rangeLine: (first, second) => `正文范围：${first}  ↔  ${second}`,
    rangeSpan: (start, end) => (start === end ? `「${start}」` : `「${start}」–「${end}」`),
    editRange: '修改',
    refilled: '已按新的正文范围重新配了章节。',
    hint: '程序已经在正文范围内按长度配了一遍，合并前请检查。蓝色是配上的，同一行左右对应。灰色虚线框是没配上的：左边的照样留在书里、只有原文，右边的不收录。',
    preparing: '正在整理章节…',
    prepareFailed: (message) => `读取章节失败：${message}`,
    restore: '恢复预填',
    collapse: '收起',
    expand: '展开',
    originalOnly: '只保留原文',
    leftOut: '不收录',
    chars: (n) => `${n.toLocaleString('zh')} 字`,
    emptySection: '没有正文',
    showEmpty: (n) => `显示 ${n} 个没有正文的节`,
    hideEmpty: '收起没有正文的节',
    idle: '要改配对：先点一边的一节，再点另一边对应的那一节。点中间的 × 拆开一对。',
    selected: (title, isFirst) =>
      `已选中「${title}」。现在点${isFirst ? '右' : '左'}边对应的那一节；再点它一次取消选中。`,
    paired: (a, b, dropped) =>
      `已配对：「${a}」↔「${b}」。${dropped > 0 ? `另外取消了 ${dropped} 条和它冲突的配对。` : ''}`,
    unpaired: '已拆开，两边都改成不合并。',
    undo: '撤销',
    unpair: '拆开这一对',
    problems:
      '标红的组交叉了，或者中间隔着别的节：两边的节都要连续，并且从上到下依次对应。改好之前不能合并。',
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
    '英文和简体中文效果最好，其他语言也可以试',
  ],

  footerPrivacy: '隐私说明',
  footerPersonalUse: '仅限个人使用',
};
