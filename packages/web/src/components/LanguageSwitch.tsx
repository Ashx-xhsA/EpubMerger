import type { Locale } from '../strings/index.tsx';
import { useLocale } from '../strings/index.tsx';

// 按钮上的字永远用各自的语言写，不跟着界面语言变
const OPTIONS: [Locale, string][] = [
  ['en', 'EN'],
  ['zh', '中文'],
];

export function LanguageSwitch() {
  const { locale, setLocale } = useLocale();
  return (
    <div className="flex items-center gap-1 text-[13px]">
      {OPTIONS.map(([value, label], i) => (
        <span key={value} className="flex items-center gap-1">
          {i > 0 && <span className="text-gray-300">/</span>}
          <button
            type="button"
            aria-pressed={locale === value}
            onClick={() => setLocale(value)}
            className={
              locale === value ? 'font-medium text-gray-900' : 'text-gray-400 hover:text-gray-700'
            }
          >
            {label}
          </button>
        </span>
      ))}
    </div>
  );
}
