// core 的 tsconfig 不加载 Node 和浏览器的类型（见 packages/core/tsconfig.json）。
// 这里只声明两边都有的少数全局对象，其他一边独有的东西仍然会报错。

/** 把字节解码成字符串。Node 和浏览器 Web Worker 都内置，支持 utf-8、gbk、utf-16le 等 */
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  readonly encoding: string;
  decode(input?: Uint8Array): string;
}

/** 把字符串编码成 UTF-8 字节。同样两边都内置 */
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

/** 生成随机 UUID（新书的 identifier 用）。Node 19+ 和浏览器（安全上下文）都内置 */
declare const crypto: { randomUUID(): string };
