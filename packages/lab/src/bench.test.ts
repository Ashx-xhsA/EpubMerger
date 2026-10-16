import { describe, expect, it } from 'vitest';
import { embedSorted } from './bench.ts';
import type { Embedder } from './embed.ts';

describe('embedSorted', () => {
  it('embeds in length order but returns vectors in the original order', async () => {
    const seen: string[] = [];
    const embedder: Embedder = {
      name: 'fake',
      dim: 1,
      async embed(texts) {
        seen.push(...texts);
        return texts.map((t) => new Float32Array([t.length]));
      },
    };
    const result = await embedSorted(embedder, ['ccc', 'a', 'bb']);
    expect(seen).toEqual(['a', 'bb', 'ccc']);
    expect(result.map((v) => v[0])).toEqual([3, 1, 2]);
  });
});
