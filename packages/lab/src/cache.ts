import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Embedder } from '@epubmerger/core';

/** 算好的向量存在这里。是从书算出来的，和书一样不进 git */
export const EMBEDDING_DIR = 'fixtures/.cache/embeddings';

const HASH_BYTES = 32;

/**
 * 给一个 Embedder 加上磁盘缓存，返回的还是 Embedder。
 *
 * 每个模型一个文件 `<name>.bin`，由一条条记录首尾相接：
 * 32 字节的 sha256(文字) + dim 个 float32。打开时整个读进内存，新算的追加到文件末尾
 */
export function withCache(inner: Embedder, dir = EMBEDDING_DIR): Embedder {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${inner.name}.bin`);
  const memo = readCache(path, inner.dim);

  return {
    name: inner.name,
    dim: inner.dim,
    async embed(texts) {
      const keys = texts.map(hashText);
      // 同一批里重复的文字只算一次
      const missing = [...new Set(keys.filter((k) => !memo.has(k)))];
      if (missing.length > 0) {
        const textOf = new Map(keys.map((k, i) => [k, texts[i]!]));
        const vectors = await inner.embed(missing.map((k) => textOf.get(k)!));
        const records: Buffer[] = [];
        missing.forEach((k, i) => {
          const v = vectors[i]!;
          memo.set(k, v);
          records.push(Buffer.from(k, 'hex'), Buffer.from(v.buffer, v.byteOffset, v.byteLength));
        });
        appendFileSync(path, Buffer.concat(records));
      }
      return keys.map((k) => memo.get(k)!);
    },
  };
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function readCache(path: string, dim: number): Map<string, Float32Array> {
  const memo = new Map<string, Float32Array>();
  if (!existsSync(path)) return memo;
  const bytes = readFileSync(path);
  const recordBytes = HASH_BYTES + dim * 4;
  // 写到一半中断时，最后一条可能不完整，直接忽略
  for (let at = 0; at + recordBytes <= bytes.length; at += recordBytes) {
    const key = bytes.subarray(at, at + HASH_BYTES).toString('hex');
    // 复制一份：Float32Array 要求起点是 4 的倍数，文件里的位置不一定是
    const vector = new Float32Array(dim);
    new Uint8Array(vector.buffer).set(bytes.subarray(at + HASH_BYTES, at + recordBytes));
    memo.set(key, vector);
  }
  return memo;
}
