import { describe, expect, it } from 'vitest';
import { cosine, normalize } from './vector.ts';

describe('normalize', () => {
  it('scales to length 1 and leaves a zero vector alone', () => {
    expect([...normalize(new Float32Array([3, 4]))]).toEqual([
      expect.closeTo(0.6),
      expect.closeTo(0.8),
    ]);
    expect([...normalize(new Float32Array([0, 0]))]).toEqual([0, 0]);
  });
});

describe('cosine', () => {
  it('is the dot product of normalized vectors', () => {
    const a = normalize(new Float32Array([1, 1]));
    expect(cosine(a, a)).toBeCloseTo(1);
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
  });
});
