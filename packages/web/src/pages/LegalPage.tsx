import { IconArrowLeft } from '@tabler/icons-react';
import { LanguageSwitch } from '../components/LanguageSwitch.tsx';
import { useLocale } from '../strings/index.tsx';

export type LegalKind = 'privacy' | 'terms';

/** 隐私说明 / 使用条款。从页脚在新标签页打开，所以"返回"是回到一个全新的首页 */
export function LegalPage({ kind }: { kind: LegalKind }) {
  const { t } = useLocale();
  const doc = t.legal[kind];

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <main className="mx-auto max-w-2xl px-4 pt-6 pb-12 sm:px-8">
        <div className="flex items-center justify-between">
          <a
            href="#"
            className="flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-800"
          >
            <IconArrowLeft size={15} />
            {t.legal.back}
          </a>
          <LanguageSwitch />
        </div>

        <h1 className="mt-8 text-2xl font-medium">{doc.title}</h1>
        <p className="mt-1 text-[13px] text-gray-400">{t.legal.updated}</p>

        {doc.sections.map((section) => (
          <section key={section.heading} className="mt-7">
            <h2 className="mb-2 text-base font-medium">{section.heading}</h2>
            {section.body.map((block, i) =>
              typeof block === 'string' ? (
                <p key={i} className="mt-2 text-[14px] leading-relaxed text-gray-700">
                  {block}
                </p>
              ) : (
                <ul
                  key={i}
                  className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-gray-700"
                >
                  {block.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}
      </main>
    </div>
  );
}
