/** 章节是按什么切的：目录、spine 文件（一个文件一节），还是全书一节 */
export type ChapterSource = 'toc' | 'spine' | 'whole';

/** 一节：块序号范围 [start, end)，对应 extractBlocks 返回的 blocks */
export interface Chapter {
  /** 目录项的标题，或文件里第一个标题块的文字，原样记录，可能是空字符串 */
  title: string;
  /** 目录里的层级，0 是最外层。按文件切时都是 0 */
  depth: number;
  start: number;
  end: number;
  /** 第一个目录项之前的块（封面、版权页等）单独成的一节 */
  beforeToc?: true;
}

export type ChapterWarningCode =
  | 'TOC_MISSING' // 没有目录，或只有 1 项
  | 'TOC_UNRELIABLE'; // 有目录但不能用来切章节

/** message 是给开发者看的细节，给用户看的文案由 UI 按 code 决定 */
export interface ChapterWarning {
  code: ChapterWarningCode;
  message: string;
}

/** 判断目录是否可靠用的几个数字，CLI 打印出来看离门槛有多远 */
export interface TocStats {
  /** 展开后的目录项数（含各级子项） */
  entries: number;
  /** 指向 spine 以外文件的目录项占比 */
  unresolvedShare: number;
  /** 第一个目录项之前的正文字数占比 */
  beforeTocShare: number;
  /** 最大一节的正文字数占比 */
  largestShare: number;
}

export interface ChapterResult {
  source: ChapterSource;
  chapters: Chapter[];
  /** 有目录时总有；没有目录时为 null */
  tocStats: TocStats | null;
  warnings: ChapterWarning[];
}
