// 两本书的语言组合对不对：两种不同的语言，并且生成出来的书排版是对的。
//
// 对齐不挑语言（长度比例按书自己算，向量模型是多语种的），所以任何两种不同的语言都可以合并：
// - 测试过的语言（第一版只有中英）不提示
// - 认得出、但没测试过的语言只警告
// - 从右往左书写的文字拦下：生成时没有 dir="rtl"，书的排版会是错的
// 以后测试了新语言、或者做了从右往左的排版，只改下面两个列表。

import type { BookLanguage, LanguageIssue, LanguagePairCheck } from './types.ts';

/** 用测试书验证过效果的语言。段落谁在前由用户在界面上选，和这里的顺序无关 */
export const TESTED_LANGUAGES: readonly string[] = ['en', 'zh-Hans'];

/** 从右往左书写的语言：阿拉伯文、希伯来文、波斯文、乌尔都文 */
export const RTL_LANGUAGES: readonly string[] = ['ar', 'he', 'fa', 'ur'];

export interface LanguageLists {
  tested: readonly string[];
  unsupported: readonly string[];
}

/** 主语言：zh-Hans、zh-Hant 都是 zh */
function primary(lang: string): string {
  return lang.split('-')[0]!;
}

/** 检查两本书的语言组合。a、b 是两本书各自的 detectLanguage(...).language */
export function checkLanguagePair(
  a: BookLanguage,
  b: BookLanguage,
  lists: LanguageLists = { tested: TESTED_LANGUAGES, unsupported: RTL_LANGUAGES },
): LanguagePairCheck {
  const issues: LanguageIssue[] = [];
  const sides = [
    ['a', a],
    ['b', b],
  ] as const;

  for (const [side, lang] of sides) {
    if (lang.kind === 'uncertain') {
      issues.push({ level: 'warning', code: 'LANGUAGE_UNCERTAIN', bookSide: side });
    }
  }

  if (a.kind === 'single' && b.kind === 'single' && primary(a.lang) === primary(b.lang)) {
    // 两本同语言时不再报别的：两本都是繁体，只说"是同一种语言"就够了
    issues.push({ level: 'error', code: 'SAME_LANGUAGE', bookSide: 'both', lang: a.lang });
  } else {
    for (const [side, lang] of sides) {
      if (lang.kind !== 'single') continue;
      if (lists.unsupported.includes(primary(lang.lang))) {
        issues.push({
          level: 'error',
          code: 'UNSUPPORTED_LANGUAGE',
          bookSide: side,
          lang: lang.lang,
        });
      } else if (!lists.tested.includes(lang.lang)) {
        issues.push({
          level: 'warning',
          code: 'UNTESTED_LANGUAGE',
          bookSide: side,
          lang: lang.lang,
        });
      }
    }
  }

  return { ok: issues.every((issue) => issue.level !== 'error'), issues };
}
