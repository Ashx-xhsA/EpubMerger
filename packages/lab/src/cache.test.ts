import { mkdtempSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withCache } from './cache.ts';
import type { Embedder } from './embed.ts';

/** 假模型：向量是 [文字长度, 调用次数]，记下每次被要求算哪些文字 */
function fakeEmbedder() {
  const calls: string[][] = [];
  const embedder: Embedder = {
    name: 'fake',
    dim: 2,
    async embed(texts) {
      calls.push(texts);
      return texts.map((t) => new Float32Array([t.length, calls.length]));
    },
  };
  return { embedder, calls };
}

const tempDir = () => mkdtempSync(join(tmpdir(), 'lab-cache-'));

describe('withCache', () => {
  it('only computes texts it has not seen, once each', async () => {
    const { embedder, calls } = fakeEmbedder();
    const cached = withCache(embedder, tempDir());

    const first = await cached.embed(['a', 'bb', 'a']);
    const second = await cached.embed(['bb', 'ccc']);

    expect(calls).toEqual([['a', 'bb'], ['ccc']]);
    expect([...first[0]!]).toEqual([1, 1]);
    expect([...first[2]!]).toEqual([1, 1]);
    expect([...second[0]!]).toEqual([2, 1]);
    expect([...second[1]!]).toEqual([3, 2]);
  });

  it('reads vectors back from disk in a new instance', async () => {
    const dir = tempDir();
    await withCache(fakeEmbedder().embedder, dir).embed(['a', 'bb']);

    const { embedder, calls } = fakeEmbedder();
    const result = await withCache(embedder, dir).embed(['bb', 'a']);

    expect(calls).toEqual([]);
    expect(result.map((v) => [...v])).toEqual([
      [2, 1],
      [1, 1],
    ]);
  });

  it('ignores a truncated last record', async () => {
    const dir = tempDir();
    await withCache(fakeEmbedder().embedder, dir).embed(['a']);
    const path = join(dir, 'fake.bin');
    appendFileSync(path, readFileSync(path).subarray(0, 10));

    const { embedder, calls } = fakeEmbedder();
    const result = await withCache(embedder, dir).embed(['a']);

    expect(calls).toEqual([]);
    expect([...result[0]!]).toEqual([1, 1]);
  });
});
