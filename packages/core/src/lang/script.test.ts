import { describe, expect, it } from 'vitest';
import { classifyParagraph, countUnits } from './script.ts';

describe('countUnits', () => {
  it('counts CJK by character and alphabetic scripts by word', () => {
    expect(countUnits('他在 Stanford 读了 machine learning 的 PhD')).toEqual({
      han: 5,
      kana: 0,
      hangul: 0,
      latin: 4,
      cyrillic: 0,
      other: 0,
    });
  });

  it('treats words with apostrophes as one word and ignores digits and punctuation', () => {
    expect(countUnits("Don't stop — l'homme, 1945!").latin).toBe(3);
  });

  it('ignores URLs and email addresses', () => {
    const c = countUnits('详见 https://example.com/some/long/path 或写信给 someone@example.org');
    expect(c.latin).toBe(0);
    expect(c.han).toBe(6);
  });

  it('counts kana, hangul, Cyrillic and other alphabets', () => {
    expect(countUnits('ひらがなとカタカナ').kana).toBe(9);
    expect(countUnits('한국어 문장').hangul).toBe(5);
    expect(countUnits('Это русский текст').cyrillic).toBe(3);
    expect(countUnits('Αυτό είναι ελληνικά').other).toBe(3);
  });
});

describe('classifyParagraph', () => {
  it('calls a Chinese sentence with a few English words Chinese', () => {
    expect(classifyParagraph('他在 Stanford 读了 machine learning 的 PhD')).toBe('zh');
  });

  it('calls plain English, Russian and Greek by script', () => {
    expect(classifyParagraph('It was the best of times, it was the worst of times.')).toBe('latin');
    expect(classifyParagraph('Это был лучший из всех времён.')).toBe('cyrillic');
    expect(classifyParagraph('Ήταν η καλύτερη των εποχών.')).toBe('other');
  });

  it('tells Japanese and Korean from Chinese', () => {
    expect(classifyParagraph('それは最良の時代であり、最悪の時代でもあった。')).toBe('ja');
    expect(classifyParagraph('그것은 최고의 시대였고 최악의 시대였다.')).toBe('ko');
    // 中文里偶尔一个假名（"の"）还是中文
    expect(
      classifyParagraph('这家店叫做“山田の店”，开在东京的一条小巷子里，已经有一百多年了。'),
    ).toBe('zh');
  });

  it('calls a half-and-half paragraph mixed', () => {
    expect(classifyParagraph('原文是 It was the best of times, it was the worst of times')).toBe(
      'mixed',
    );
  });

  it('skips paragraphs that are too short', () => {
    expect(classifyParagraph('* * *')).toBe('short');
    expect(classifyParagraph('Chapter 1')).toBe('short');
    expect(classifyParagraph('第一章')).toBe('short');
  });
});
