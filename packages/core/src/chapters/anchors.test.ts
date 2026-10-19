import { describe, expect, it } from 'vitest';
import type { Block, Region } from '../extract/types.ts';
import { guessAnchors } from './anchors.ts';
import type { Section } from './map.ts';
import { pairFromAnchor } from './prefill.ts';

function block(text: string, region: Region): Block {
  return {
    kind: 'para',
    text,
    html: '',
    range: [0, 0],
    file: 'a.xhtml',
    ids: [],
    className: '',
    region,
  };
}

/** 一节：标题、字数，内容的区域默认是正文 */
const section = (title: string, chars: number, region: Region = 'body'): Section => ({
  title,
  depth: 0,
  blocks: chars === 0 ? [] : [block('x'.repeat(chars), region)],
});

const en = [
  section('Cover', 0),
  section('Copyright', 700, 'copyright'),
  section('Contents', 300, 'toc'),
  section('Chapter 1', 20000),
  section('Chapter 2', 24000),
  section('Chapter 3', 22000),
  section('Afterword', 7000, 'preface'),
  section('Sneak peek at the next book', 29000),
  section('About the Author', 300, 'about-author'),
];
const zh = [
  section('（目录前）', 5000),
  section('版权信息', 200, 'copyright'),
  section('第一章', 8000),
  section('第二章', 9500),
  section('第三章', 8800),
  section('致谢', 900, 'acknowledgments'),
];

describe('guessAnchors', () => {
  it('skips front and back matter on both sides', () => {
    expect(guessAnchors(en, zh)).toEqual({ from: { en: 3, zh: 2 }, to: { en: 5, zh: 4 } });
  });

  it('keeps a preface only when both books have one', () => {
    const withIntro = (s: Section[], title: string, at: number) => [
      ...s.slice(0, at),
      section(title, 6000),
      ...s.slice(at),
    ];
    expect(guessAnchors(withIntro(en, 'Introduction', 3), zh).from).toEqual({ en: 4, zh: 2 });
    expect(guessAnchors(withIntro(en, 'Introduction', 3), withIntro(zh, '引言', 2)).from).toEqual({
      en: 3,
      zh: 2,
    });
  });
});

describe('pairFromAnchor', () => {
  it('leaves everything outside the anchors unmerged and pairs the rest by length', () => {
    const groups = pairFromAnchor(en, zh, { en: 3, zh: 2 }, { en: 5, zh: 4 });
    expect(groups.filter((g) => g.en.length > 0 && g.zh.length > 0)).toEqual([
      { en: [3], zh: [2] },
      { en: [4], zh: [3] },
      { en: [5], zh: [4] },
    ]);
    expect(groups.flatMap((g) => g.en).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
