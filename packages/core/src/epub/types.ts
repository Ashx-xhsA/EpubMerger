/** 解析好的一本书。只包含结构信息，正文要用 readText 按需读取。 */
export interface Book {
  /** OPF 里 package 的 version，通常是 "2.0" 或 "3.0" */
  version: string;
  metadata: BookMetadata;
  /** OPF 在 zip 里的路径，如 "OEBPS/content.opf"。OPF 里的相对路径都以它所在的文件夹为基准 */
  opfPath: string;
  /** manifest：id → 文件信息，书里所有文件的清单 */
  manifest: Map<string, ManifestItem>;
  /** spine：阅读顺序 */
  spine: SpineItem[];
  /** 目录树（给读者看的目录），没有目录时是空数组 */
  toc: TocEntry[];
  /** 目录是从哪里读到的 */
  tocSource: 'nav' | 'ncx' | 'none';
  /** zip 里所有文件的路径（不含文件夹），生成 ePub 时原样复制骨架书的文件用 */
  files: string[];
  /** 按 zip 内路径读出文件的文字（自动处理编码和 %20 等写法），文件不存在时返回 null */
  readText(path: string): string | null;
  /** 按 zip 内路径原样读出字节（图片、字体用），文件不存在时返回 null */
  readBytes(path: string): Uint8Array | null;
}

export interface BookMetadata {
  title: string;
  /** 作者，可能有多个 */
  creators: string[];
  /** OPF 里声明的语言，原样记录。不可信，真正的语言由 0.5 语言识别决定 */
  languages: string[];
  /** ISBN、UUID 等，取 package 的 unique-identifier 指向的那个 */
  identifier: string | null;
}

export interface ManifestItem {
  id: string;
  /** zip 内完整路径（已拼上 OPF 所在文件夹） */
  href: string;
  /** 文件类型，如 "application/xhtml+xml"、"image/jpeg" */
  mediaType: string;
  /** ePub 3 的特殊标记，如 "nav"、"cover-image"。ePub 2 的书是空数组 */
  properties: string[];
}

export interface SpineItem {
  /** spine 里写的 id，对应 manifest 的 key */
  idref: string;
  /** 用 idref 在 manifest 里查到的 zip 内完整路径 */
  href: string;
  /** linear="no" 时为 false：不在正常翻页顺序里的内容，如单独显示的封面、只能点链接打开的注释页 */
  linear: boolean;
}

export interface TocEntry {
  title: string;
  /** zip 内完整路径，不含 # 后面的部分 */
  href: string;
  /** # 后面的锚点，指向文件里的某个位置；没有时为 null，表示从文件开头开始 */
  fragment: string | null;
  /** 下一级目录 */
  children: TocEntry[];
}

export type ParseErrorCode =
  | 'NOT_EPUB'
  | 'CORRUPTED'
  | 'DRM_PROTECTED'
  | 'FIXED_LAYOUT'
  | 'NO_TEXT'
  | 'TOO_LARGE'
  | 'VERTICAL_LAYOUT';

/** 书不能用的原因。message 是给开发者看的细节，给用户看的文案由 UI 按 code 决定 */
export interface ParseError {
  code: ParseErrorCode;
  message: string;
}

/** 不影响继续，但值得知道的问题，如 nav 不可用已改用 NCX */
export interface ParseWarning {
  code: string;
  message: string;
}

/** 解析结果：要么成功拿到 book，要么失败拿到 error。调用方必须先检查 ok */
export type ParseResult =
  { ok: true; book: Book; warnings: ParseWarning[] } | { ok: false; error: ParseError };
