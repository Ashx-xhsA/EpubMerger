import { describe, expect, it } from 'vitest';
import type { Embedder } from '../align/embedder.ts';
import { normalize } from '../align/vector.ts';
import type { Block } from '../extract/types.ts';
import type { Section } from './map.ts';
import { headAndTail, prefillChapters, sectionVectors } from './prefill.ts';

function block(text: string): Block {
  return { kind: 'para', text, html: '', file: 'a.xhtml', ids: [], className: '', region: 'body' };
}

const section = (title: string, ...texts: string[]): Section => ({
  title,
  depth: 0,
  blocks: texts.map(block),
});

/** 假的模型：文字里出现哪个关键词，就返回哪个方向的向量 */
const KEYWORDS = ['whale', 'storm', 'island', 'home'];
const fake: Embedder = {
  name: 'fake',
  dim: KEYWORDS.length,
  embed(texts) {
    return Promise.resolve(
      texts.map((t) =>
        normalize(new Float32Array(KEYWORDS.map((k) => (t.includes(k) ? 1 : 0.01)))),
      ),
    );
  },
};

describe('headAndTail', () => {
  it('takes the title plus the first and the last n characters', () => {
    const s = section('One', 'abcdef', 'ghij');
    expect(headAndTail(s, 3)).toEqual({ head: 'One\nabc', tail: 'hij' });
  });
});

describe('sectionVectors', () => {
  it('gives one normalized vector per section', async () => {
    const vectors = await sectionVectors([section('a', 'whale'), section('b', 'storm')], fake);
    expect(vectors).toHaveLength(2);
    expect(Math.hypot(...vectors[0]!)).toBeCloseTo(1);
  });
});

describe('prefillChapters', () => {
  // 英文：扉页（空）、译文没有的前言、三章；中文：译者序、三章
  const en = [
    section('Title'),
    section('Preface', 'home'),
    section('One', 'whale'),
    section('Two', 'storm'),
    section('Three', 'island'),
  ];
  const zh = [
    section('译者序', 'zzz'),
    section('第一章', 'whale'),
    section('第二章', 'storm'),
    section('第三章', 'island'),
  ];

  it('pairs by meaning, leaves unmatched sections unmerged and keeps book order', async () => {
    const result = await prefillChapters(en, zh, { embedder: fake });
    expect(result.method).toBe('meaning');
    expect(result.groups).toEqual([
      { en: [0], zh: [] },
      { en: [1], zh: [] },
      { en: [], zh: [0] },
      { en: [2], zh: [1] },
      { en: [3], zh: [2] },
      { en: [4], zh: [3] },
    ]);
  });

  it('falls back to order without an embedder', async () => {
    const result = await prefillChapters(en, zh);
    expect(result.method).toBe('order');
    expect(result.groups[0]).toEqual({ en: [0], zh: [] });
    expect(result.groups[1]).toEqual({ en: [1], zh: [0] });
  });
});
