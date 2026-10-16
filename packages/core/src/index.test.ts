import { describe, expect, it } from 'vitest';
import { describeMerge } from './index.ts';

describe('describeMerge', () => {
  it('describes the two input files', () => {
    expect(describeMerge('en.epub', 'zh.epub')).toBe('merge en.epub + zh.epub');
  });
});
