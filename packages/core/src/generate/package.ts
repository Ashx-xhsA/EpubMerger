import { strToU8, zipSync, type Zippable } from 'fflate';

/**
 * 打包成 ePub：mimetype 必须是 zip 里的第一个文件而且不压缩（阅读器靠文件开头的固定字节认出 ePub），
 * 其他文件压缩。files 里的 mimetype 会被忽略，统一写新的
 */
export function packageEpub(files: Map<string, Uint8Array>): Uint8Array {
  // 对象的 key 按插入顺序排列，所以 mimetype 会是第一个
  const zippable: Zippable = { mimetype: [strToU8('application/epub+zip'), { level: 0 }] };
  for (const [path, data] of files) {
    if (path === 'mimetype') continue;
    zippable[path] = [data, { level: 6 }];
  }
  return zipSync(zippable);
}
