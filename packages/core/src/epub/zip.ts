import { unzipSync } from 'fflate';
import type { ParseError } from './types.ts';

/** 输入文件的上限 */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** 解压后总大小的上限，防止"压缩炸弹"（很小的 zip 解开有几个 GB） */
export const MAX_UNZIPPED_BYTES = 500 * 1024 * 1024;

/** 解压后的文件表 */
export interface ZipArchive {
  /** zip 里所有文件的路径（不含文件夹） */
  paths: string[];
  /** 按路径取字节。先精确匹配，找不到再忽略大小写匹配；都找不到返回 null */
  read(path: string): Uint8Array | null;
}

export type UnzipResult = { ok: true; archive: ZipArchive } | { ok: false; error: ParseError };

export interface ZipLimits {
  maxFileBytes: number;
  maxUnzippedBytes: number;
}

const DEFAULT_LIMITS: ZipLimits = {
  maxFileBytes: MAX_FILE_BYTES,
  maxUnzippedBytes: MAX_UNZIPPED_BYTES,
};

/** limits 一般不用传，测试时可以传小一点的上限 */
export function unzipEpub(bytes: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): UnzipResult {
  if (bytes.length > limits.maxFileBytes) {
    return fail('TOO_LARGE', `file is ${bytes.length} bytes, limit is ${limits.maxFileBytes}`);
  }
  // zip 文件都以 "PK" 开头
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return fail('NOT_EPUB', 'not a zip file');
  }

  // 第一遍：只读 zip 目录里记录的原始大小，一个文件都不解压
  let total = 0;
  try {
    unzipSync(bytes, {
      filter: (file) => {
        total += file.originalSize;
        return false;
      },
    });
  } catch (e) {
    return fail('NOT_EPUB', `cannot read zip: ${String(e)}`);
  }
  if (total > limits.maxUnzippedBytes) {
    return fail(
      'TOO_LARGE',
      `unzipped size is ${total} bytes, limit is ${limits.maxUnzippedBytes}`,
    );
  }

  // 第二遍：真正解压
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (e) {
    return fail('NOT_EPUB', `cannot unzip: ${String(e)}`);
  }

  const files = new Map<string, Uint8Array>();
  const lowercase = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue; // 文件夹
    files.set(name, data);
    // 大小写不同的同名文件很少见，有的话保留第一个
    if (!lowercase.has(name.toLowerCase())) lowercase.set(name.toLowerCase(), data);
  }

  return {
    ok: true,
    archive: {
      paths: [...files.keys()],
      read: (path) => files.get(path) ?? lowercase.get(path.toLowerCase()) ?? null,
    },
  };
}

function fail(code: ParseError['code'], message: string): UnzipResult {
  return { ok: false, error: { code, message } };
}
