import { describe, expect, it } from 'vitest';
import { applyDense, denseFromSafetensors, normalize, parseSafetensors } from './dense.ts';

/** 按 safetensors 格式拼一个文件。pad 用来让数据区从不是 4 的倍数的位置开始 */
function makeSafetensors(tensors: Record<string, { shape: number[]; values: number[] }>, pad = '') {
  const header: Record<string, unknown> = { __metadata__: { format: 'pt' } };
  const chunks: Float32Array[] = [];
  let offset = 0;
  for (const [name, { shape, values }] of Object.entries(tensors)) {
    header[name] = { dtype: 'F32', shape, data_offsets: [offset, offset + values.length * 4] };
    chunks.push(new Float32Array(values));
    offset += values.length * 4;
  }
  const json = new TextEncoder().encode(JSON.stringify(header) + pad);
  const bytes = new Uint8Array(8 + json.length + offset);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(json.length), true);
  bytes.set(json, 8);
  let at = 8 + json.length;
  for (const c of chunks) {
    bytes.set(new Uint8Array(c.buffer), at);
    at += c.byteLength;
  }
  return bytes;
}

describe('parseSafetensors', () => {
  it('reads shapes and values, skipping metadata', () => {
    const bytes = makeSafetensors({
      a: { shape: [2, 2], values: [1, 2, 3, 4] },
      b: { shape: [2], values: [0.5, -0.5] },
    });
    const tensors = parseSafetensors(bytes);
    expect([...tensors.keys()]).toEqual(['a', 'b']);
    expect(tensors.get('a')!.shape).toEqual([2, 2]);
    expect([...tensors.get('a')!.data]).toEqual([1, 2, 3, 4]);
    expect([...tensors.get('b')!.data]).toEqual([0.5, -0.5]);
  });

  it('works when the data section is not 4-byte aligned', () => {
    const bytes = makeSafetensors({ a: { shape: [1], values: [7] } }, ' ');
    expect([...parseSafetensors(bytes).get('a')!.data]).toEqual([7]);
  });
});

describe('applyDense', () => {
  it('computes tanh(W·x + b) with W stored as [out, in]', () => {
    const layer = denseFromSafetensors(
      makeSafetensors({
        // 输出 3 维、输入 2 维
        'linear.weight': { shape: [3, 2], values: [1, 0, 0, 1, 1, 1] },
        'linear.bias': { shape: [3], values: [0, 0, -3] },
      }),
    );
    const y = applyDense(layer, new Float32Array([1, 2]));
    expect(y[0]).toBeCloseTo(Math.tanh(1));
    expect(y[1]).toBeCloseTo(Math.tanh(2));
    expect(y[2]).toBeCloseTo(Math.tanh(0));
  });

  it('rejects input of the wrong length', () => {
    const layer = denseFromSafetensors(
      makeSafetensors({
        'linear.weight': { shape: [1, 2], values: [1, 1] },
        'linear.bias': { shape: [1], values: [0] },
      }),
    );
    expect(() => applyDense(layer, new Float32Array([1, 2, 3]))).toThrow();
  });
});

describe('normalize', () => {
  it('scales to length 1 and leaves zero vectors alone', () => {
    expect([...normalize(new Float32Array([3, 4]))]).toEqual([
      expect.closeTo(0.6),
      expect.closeTo(0.8),
    ]);
    expect([...normalize(new Float32Array([0, 0]))]).toEqual([0, 0]);
  });
});
