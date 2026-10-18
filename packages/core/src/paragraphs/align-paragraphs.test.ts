import { describe, expect, it } from 'vitest';
import type { Pair } from '../align/align.ts';
import type { Embedder } from '../align/embedder.ts';
import { normalize } from '../align/vector.ts';
import type { Block } from '../extract/types.ts';
import { alignParagraphs, isSymbolOnly, withSymbols } from './align-paragraphs.ts';

function block(text: string): Block {
  return {
    kind: 'para',
    text,
    html: '',
    range: [0, 0],
    file: 'a.xhtml',
    ids: [],
    className: '',
    region: 'body',
  };
}

/** 假的模型：文字里出现哪个关键词（中文用对应的词），就返回哪个方向的向量 */
const KEYWORDS = [
  ['whale', '鲸'],
  ['storm', '风暴'],
  ['island', '岛'],
  ['home', '家'],
];
const fake: Embedder = {
  name: 'fake',
  dim: KEYWORDS.length,
  embed(texts) {
    return Promise.resolve(
      texts.map((t) =>
        normalize(
          new Float32Array(KEYWORDS.map((ks) => (ks.some((k) => t.includes(k)) ? 1 : 0.01))),
        ),
      ),
    );
  },
};

/** 每个块在结果里恰好出现一次，而且两边各自按原来的顺序 */
function expectEveryBlockOnce(pairs: Pair[], enCount: number, zhCount: number) {
  expect(pairs.flatMap((p) => p.en)).toEqual([...Array(enCount).keys()]);
  expect(pairs.flatMap((p) => p.zh)).toEqual([...Array(zhCount).keys()]);
}

describe('isSymbolOnly', () => {
  it('finds blocks without letters, digits or Chinese characters', () => {
    expect(['—', '◆◆◆◆ ◆◆◆◆', '* * *'].map((t) => isSymbolOnly(block(t)))).toEqual([
      true,
      true,
      true,
    ]);
    expect(['16', 'TH(E)', '雨如泪下。'].map((t) => isSymbolOnly(block(t)))).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('withSymbols', () => {
  it('puts each symbol block before the first pair that comes after it', () => {
    const en = ['a', '* * *', 'b'].map(block);
    const zh = ['甲', '乙', '◆'].map(block);
    const pairs = [
      { en: [0], zh: [0] },
      { en: [2], zh: [1] },
    ];
    expect(withSymbols(pairs, en, zh)).toEqual([
      { en: [0], zh: [0] },
      { en: [1], zh: [] },
      { en: [2], zh: [1] },
      { en: [], zh: [2] },
    ]);
  });
});

describe('alignParagraphs', () => {
  const en = [
    'The whale rose out of the grey water.',
    '* * *',
    'A storm came in from the west that night.',
    'They sailed for the island at dawn.',
    'At last they were home.',
  ].map(block);
  const zh = [
    '鲸从灰色的水里浮了上来。',
    '那天夜里，风暴从西边来了。',
    '◆',
    '黎明时他们驶向岛。',
    '他们终于到家了。',
  ].map(block);

  it('pairs by length and meaning, and keeps every block in book order', async () => {
    const result = await alignParagraphs(en, zh, { embedder: fake });
    expect(result.method).toBe('combined');
    expectEveryBlockOnce(result.pairs, en.length, zh.length);
    expect(result.pairs).toEqual([
      { en: [0], zh: [0] },
      { en: [1], zh: [] },
      { en: [2], zh: [1] },
      { en: [], zh: [2] },
      { en: [3], zh: [3] },
      { en: [4], zh: [4] },
    ]);
  });

  it('falls back to length only without a model', async () => {
    const result = await alignParagraphs(en, zh);
    expect(result.method).toBe('length');
    expectEveryBlockOnce(result.pairs, en.length, zh.length);
  });

  it('handles groups where one side has nothing to pair', async () => {
    const result = await alignParagraphs(['—'].map(block), zh, { embedder: fake });
    expectEveryBlockOnce(result.pairs, 1, zh.length);
    expect(result.pairs.every((p) => p.en.length === 0 || p.zh.length === 0)).toBe(true);
  });
});
