// 两本书的语言组合对不对：两种不同的语言，而且都在支持列表里。
//
// 产品范围的限制只在支持列表一处：以后开放日英、法英时只改列表。

import type { BookLanguage, LanguageIssue, LanguagePairCheck } from './types.ts';

/** 第一版支持的语言。段落谁在前由用户在界面上选，和这里的顺序无关 */
export const SUPPORTED_LANGUAGES: readonly string[] = ['en', 'zh-Hans'];

/** 主语言：zh-Hans、zh-Hant 都是 zh */
function primary(lang: string): string {
  return lang.split('-')[0]!;
}

/** 检查两本书的语言组合。a、b 是两本书各自的 detectLanguage(...).language */
export function checkLanguagePair(
  a: BookLanguage,
  b: BookLanguage,
  supported: readonly string[] = SUPPORTED_LANGUAGES,
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
    // 两本同语言时不再报"不支持"：两本都是繁体，只说"是同一种语言"就够了
    issues.push({ level: 'error', code: 'SAME_LANGUAGE', bookSide: 'both', lang: a.lang });
  } else {
    for (const [side, lang] of sides) {
      if (lang.kind === 'single' && !supported.includes(lang.lang)) {
        issues.push({
          level: 'error',
          code: 'UNSUPPORTED_LANGUAGE',
          bookSide: side,
          lang: lang.lang,
        });
      }
    }
  }

  return { ok: issues.every((issue) => issue.level !== 'error'), issues };
}
