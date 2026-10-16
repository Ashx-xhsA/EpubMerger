// 字节 → 字符串。大多数 ePub 是 UTF-8，但老的中文书可能是 GBK，要按文件自己的声明解码。

/** 只看文件开头这么多字节找编码声明 */
const HEAD_BYTES = 1024;

const XML_ENCODING = /<\?xml[^>]*?encoding\s*=\s*["']([^"']+)["']/i;
const META_CHARSET = /<meta[^>]*?charset\s*=\s*["']?([\w.:-]+)/i;

/**
 * 判断编码的顺序：
 * 1. 开头的 BOM（标明编码的特殊字节）
 * 2. <?xml encoding="..."?> 或 <meta charset="...">
 * 3. 默认 UTF-8
 * 声明了不认识的编码名时退回 UTF-8。
 */
export function detectEncoding(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';

  // 编码声明只用 ASCII 字符，所以开头的字节可以逐个当成字符来看
  const head = String.fromCharCode(...bytes.subarray(0, HEAD_BYTES));
  const declared = XML_ENCODING.exec(head)?.[1] ?? META_CHARSET.exec(head)?.[1];
  if (declared === undefined) return 'utf-8';
  try {
    return new TextDecoder(declared).encoding;
  } catch {
    return 'utf-8';
  }
}

/** 按 detectEncoding 的结果解码。开头的 BOM 会被去掉 */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder(detectEncoding(bytes)).decode(bytes);
}
