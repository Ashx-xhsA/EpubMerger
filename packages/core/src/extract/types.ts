/** 块的种类，按原来的 HTML 标签决定 */
export type BlockKind =
  | 'heading' // <h1>–<h6>
  | 'para' // <p>、<div> 等
  | 'image' // 图片，或只含图片的段落
  | 'list' // <li>、<dt>、<dd>
  | 'quote' // 没有子段落的 <blockquote>
  | 'table' // 整个 <table>
  | 'other'; // 分隔符（* * *、◇）等

/** 块属于正文还是哪一种非正文。0.4 只贴标签，哪些参与对齐由 0.8 决定 */
export type Region =
  | 'body'
  | 'cover'
  | 'titlepage'
  | 'copyright'
  | 'toc'
  | 'praise' // 推荐语、Praise for…
  | 'also-by'
  | 'about-author'
  | 'translator' // 译者序、译后记、出版说明、推荐序
  | 'preface' // 前言、序言、导论；Preface、Foreword、Introduction
  | 'dedication'
  | 'epigraph'
  | 'acknowledgments'
  | 'notes' // 注释文件，或正文里的脚注块
  | 'bibliography'
  | 'index'
  | 'auxiliary'; // linear="no" 而又认不出是什么的文件

export interface Block {
  kind: BlockKind;
  /** 纯文本，对齐用：实体已解码，<br> 是换行，其他空白合成一个空格，脚注引用号已去掉 */
  text: string;
  /** 原始 HTML，0.11 生成时用 */
  html: string;
  /** 所在 spine 文件的 zip 内路径 */
  file: string;
  /**
   * 块自己和里面所有元素的 id。包着这个块的容器（如 <section id="c2">）的 id、
   * 被丢掉的空块的 id 也算在它后面第一个块上，这样目录的锚点总能对到某个块
   */
  ids: string[];
  /** 原来的 class，没有时是空字符串。0.6 认"像标题的段落"（如 p.h1）时用 */
  className: string;
  /** kind 为 heading 时是 1–6 */
  headingLevel?: number;
  region: Region;
}

/** 一个 spine 文件的抽取情况 */
export interface FileInfo {
  href: string;
  region: Region;
  /** 为什么判成这个 region，如 "epub:type=index"、"toc title: 版权信息"，人工检查用 */
  reason: string;
  /** 这个文件抽出了多少块 */
  blockCount: number;
}

export interface ExtractResult {
  /** 全书按 spine 顺序的块 */
  blocks: Block[];
  /** 每个 spine 文件一项，顺序同 spine */
  files: FileInfo[];
}
