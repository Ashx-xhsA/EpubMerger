import { describe, expect, it } from 'vitest';
import { checkLanguagePair } from './pair.ts';
import type { BookLanguage } from './types.ts';

const lang = (code: string): BookLanguage => ({ kind: 'single', lang: code });
const uncertain: BookLanguage = { kind: 'uncertain' };

describe('checkLanguagePair', () => {
  it('passes an English and a Simplified Chinese book', () => {
    expect(checkLanguagePair(lang('en'), lang('zh-Hans'))).toEqual({ ok: true, issues: [] });
    expect(checkLanguagePair(lang('zh-Hans'), lang('en'))).toEqual({ ok: true, issues: [] });
  });

  it('rejects two books in the same language, including Simplified + Traditional', () => {
    for (const [a, b] of [
      ['en', 'en'],
      ['zh-Hans', 'zh-Hans'],
      ['zh-Hans', 'zh-Hant'],
      ['zh-Hant', 'zh-Hant'],
    ] as const) {
      expect(checkLanguagePair(lang(a), lang(b))).toEqual({
        ok: false,
        issues: [{ level: 'error', code: 'SAME_LANGUAGE', bookSide: 'both', lang: a }],
      });
    }
  });

  it('rejects unsupported languages and says which book and language', () => {
    expect(checkLanguagePair(lang('en'), lang('zh-Hant'))).toEqual({
      ok: false,
      issues: [{ level: 'error', code: 'UNSUPPORTED_LANGUAGE', bookSide: 'b', lang: 'zh-Hant' }],
    });
    expect(checkLanguagePair(lang('fr'), lang('ja')).issues).toEqual([
      { level: 'error', code: 'UNSUPPORTED_LANGUAGE', bookSide: 'a', lang: 'fr' },
      { level: 'error', code: 'UNSUPPORTED_LANGUAGE', bookSide: 'b', lang: 'ja' },
    ]);
  });

  it('only warns when a language cannot be determined', () => {
    expect(checkLanguagePair(uncertain, lang('en'))).toEqual({
      ok: true,
      issues: [{ level: 'warning', code: 'LANGUAGE_UNCERTAIN', bookSide: 'a' }],
    });
  });

  it('opens another language pair by changing only the supported list', () => {
    expect(checkLanguagePair(lang('ja'), lang('en'), ['en', 'ja'])).toEqual({
      ok: true,
      issues: [],
    });
  });
});
