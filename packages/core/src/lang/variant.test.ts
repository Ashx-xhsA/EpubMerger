import { describe, expect, it } from 'vitest';
import { VARIANT_CHARS, countVariants } from './variant.ts';

describe('VARIANT_CHARS', () => {
  it('has 60 pairs with no character listed twice', () => {
    const values = [...VARIANT_CHARS.values()];
    expect(values.filter((v) => v === 'traditional')).toHaveLength(60);
    expect(values.filter((v) => v === 'simplified')).toHaveLength(60);
  });
});

describe('countVariants', () => {
  it('counts traditional-only and simplified-only characters', () => {
    expect(countVariants('這是我們的書，他們說來不及了。')).toEqual({
      traditional: 6,
      simplified: 0,
    });
    expect(countVariants('这是我们的书，他们说来不及了。')).toEqual({
      traditional: 0,
      simplified: 6,
    });
  });

  it('ignores characters shared by both and non-Chinese text', () => {
    expect(countVariants('皇后在公里之外 the queen')).toEqual({ traditional: 0, simplified: 0 });
  });
});
