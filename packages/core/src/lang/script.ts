// 判断一段文字用的是哪种文字。
//
// 汉字、假名、谚文一个字算一个单位，拼音文字一个词算一个单位：一个英文单词的信息量大约相当于
// 一两个汉字，按字母数算会让夹着几个英文词的中文段落被判成英文。

import type { ParagraphClass, UnitCounts } from './types.ts';

/** 汉字 + 假名 + 谚文至少占这么多，算中日韩段。中文书里常夹英文词，所以门槛低 */
export const CJK_SHARE = 0.5;
/** 一种字母文字至少占这么多，算这种文字的段 */
export const ALPHABETIC_SHARE = 0.9;
/** 单位少于这个数的段落不投票（"* * *"、"Chapter 1"） */
export const MIN_UNITS = 4;
/** 中日韩段里假名至少占这么多算日文。中文段偶尔有一两个假名（日本人名、"の"） */
export const KANA_SHARE = 0.1;

const URL_OR_EMAIL = /https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const HAN = /\p{Script=Han}/gu;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const HANGUL = /\p{Script=Hangul}/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
/** 一个词：字母开头，可以带撇号（don't、l'homme 算一个词） */
const WORD = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;

function countMatches(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

/** 数一段文字里的各种单位。URL 和邮箱不算 */
export function countUnits(text: string): UnitCounts {
  const clean = text.replace(URL_OR_EMAIL, ' ');
  const counts: UnitCounts = {
    han: countMatches(clean, HAN),
    kana: countMatches(clean, KANA),
    hangul: countMatches(clean, HANGUL),
    latin: 0,
    cyrillic: 0,
    other: 0,
  };
  // 中日韩的字已经数过，换成空格后剩下的就是拼音文字的词
  for (const word of clean.replace(CJK, ' ').match(WORD) ?? []) {
    if (/^\p{Script=Latin}/u.test(word)) counts.latin++;
    else if (/^\p{Script=Cyrillic}/u.test(word)) counts.cyrillic++;
    else counts.other++;
  }
  return counts;
}

/** 判一段是什么文字，规则见 ParagraphClass */
export function classifyParagraph(text: string): ParagraphClass {
  const c = countUnits(text);
  const cjk = c.han + c.kana + c.hangul;
  const total = cjk + c.latin + c.cyrillic + c.other;
  if (total < MIN_UNITS) return 'short';
  if (cjk / total >= CJK_SHARE) {
    if (c.hangul > cjk / 2) return 'ko';
    if (c.kana / cjk >= KANA_SHARE) return 'ja';
    return 'zh';
  }
  for (const script of ['latin', 'cyrillic', 'other'] as const) {
    if (c[script] / total >= ALPHABETIC_SHARE) return script;
  }
  return 'mixed';
}
