// 当前界面语言。用 React Context 让整页共享：切换时所有组件一起更新

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { en } from './en.ts';
import type { Strings } from './en.ts';
import { zh } from './zh.ts';

export type Locale = 'en' | 'zh';

const STRINGS: Record<Locale, Strings> = { en, zh };
const STORAGE_KEY = 'epubmerger.locale';

/** 上次选过就用上次的；否则中文浏览器显示中文，其他显示英文 */
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    // 隐私模式等情况下读不到，用默认语言
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Strings;
}

const LocaleContext = createContext<LocaleState | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(initialLocale);
  const t = STRINGS[locale];

  useEffect(() => {
    // 屏幕阅读器和浏览器翻译插件靠 <html lang> 判断页面语言
    document.documentElement.lang = t.htmlLang;
  }, [t]);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 存不下就只在这次打开时有效
    }
  };

  return <LocaleContext value={{ locale, setLocale, t }}>{children}</LocaleContext>;
}

export function useLocale(): LocaleState {
  const state = useContext(LocaleContext);
  if (state === null) throw new Error('useLocale must be used inside LocaleProvider');
  return state;
}

/** 语言代码 → 当前界面语言里的名字（en → English / 英文） */
export function languageName(t: Strings, lang: string): string {
  return t.languageNames[lang] ?? lang;
}
