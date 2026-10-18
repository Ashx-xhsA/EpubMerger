import {
  IconArrowsExchange,
  IconBulb,
  IconCheck,
  IconDownload,
  IconLock,
} from '@tabler/icons-react';
import { useState } from 'react';
import { BookSlot } from './components/BookSlot.tsx';
import type { SlotState } from './components/BookSlot.tsx';
import { LanguageSwitch } from './components/LanguageSwitch.tsx';
import { LayoutPicker } from './components/LayoutPicker.tsx';
import { loadBook, mergeBooks } from './pipeline.ts';
import type { Layout, MergeStats } from './pipeline.ts';
import { languageName, useLocale } from './strings/index.tsx';
import type { Strings } from './strings/en.ts';

type MergeState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; url: string; fileName: string; stats: MergeStats }
  /** 错误提示是按当前界面语言生成文字的函数，切换语言后跟着变 */
  | { status: 'error'; message: (t: Strings) => string };

let nextId = 0;

/** 让浏览器先把"读取中 / 合并中"画出来，再开始卡住主线程的计算（1.2 改用 Worker 后不需要） */
const paint = () => new Promise((resolve) => setTimeout(resolve, 30));

export function App() {
  const { t } = useLocale();
  const [slots, setSlots] = useState<[SlotState, SlotState]>([
    { status: 'empty' },
    { status: 'empty' },
  ]);
  const [layout, setLayout] = useState<Layout>('stacked');
  const [merge, setMerge] = useState<MergeState>({ status: 'idle' });

  /** 书、顺序、排版一变，之前的合并结果就作废 */
  const resetMerge = () => {
    if (merge.status === 'done') URL.revokeObjectURL(merge.url);
    setMerge({ status: 'idle' });
  };

  /** 按 id 找到这次上传现在在哪个框里（中途可能被交换），更新它；已被移除或替换就丢掉 */
  const updateSlot = (id: number, next: SlotState) =>
    setSlots(
      (current) => current.map((s) => ('id' in s && s.id === id ? next : s)) as typeof current,
    );

  const onFile = async (index: 0 | 1, file: File) => {
    resetMerge();
    const id = nextId++;
    setSlots((current) => {
      const copy: typeof current = [...current];
      copy[index] = { status: 'loading', id, fileName: file.name };
      return copy;
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    await paint();
    const result = loadBook(bytes, file.name);
    updateSlot(
      id,
      result.ok
        ? { status: 'ready', id, fileName: file.name, book: result.book }
        : { status: 'error', id, fileName: file.name, code: result.code },
    );
  };

  const onRemove = (index: 0 | 1) => {
    resetMerge();
    setSlots((current) => {
      const copy: typeof current = [...current];
      copy[index] = { status: 'empty' };
      return copy;
    });
  };

  const onSwap = () => {
    resetMerge();
    setSlots(([a, b]) => [b, a]);
  };

  const onLayout = (next: Layout) => {
    resetMerge();
    setLayout(next);
  };

  const [first, second] = slots;
  const bothReady = first.status === 'ready' && second.status === 'ready';

  const onMerge = async () => {
    if (first.status !== 'ready' || second.status !== 'ready') return;
    resetMerge();
    setMerge({ status: 'running' });
    await paint();
    const result = await mergeBooks(first.book, second.book, { layout });
    if (result.ok) {
      const url = URL.createObjectURL(
        new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: 'application/epub+zip' }),
      );
      const fileName = `${first.book.title.replace(/[\\/:*?"<>|]/g, '_')} (bilingual).epub`;
      setMerge({ status: 'done', url, fileName, stats: result.stats });
    } else if ('issues' in result) {
      const issue = result.issues.find((i) => i.level === 'error') ?? result.issues[0]!;
      setMerge({
        status: 'error',
        message: (t) => t.mergeIssue[issue.code](languageName(t, issue.lang ?? '')),
      });
    } else {
      const { message } = result;
      setMerge({ status: 'error', message: (t) => t.mergeFailed(message) });
    }
  };

  /** 示意图说明里用的名字：识别出的语言，没上传或认不出时用"第 n 本" */
  const nameOf = (slot: SlotState, n: number) =>
    slot.status === 'ready' && slot.book.language.kind === 'single'
      ? languageName(t, slot.book.language.lang)
      : t.bookFallback(n);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <main className="mx-auto max-w-3xl px-4 pt-6 pb-8 sm:px-8">
        <div className="flex justify-end">
          <LanguageSwitch />
        </div>

        <header className="mt-6 mb-8 text-center">
          <h1 className="text-[28px] font-medium">EpubMerger</h1>
          <p className="mt-1.5 text-[15px] text-gray-600">{t.tagline}</p>
          <p className="mt-1 flex items-center justify-center gap-1 text-[13px] text-gray-400">
            <IconLock size={14} />
            {t.privacy}
          </p>
        </header>

        <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <BookSlot
            position={1}
            state={first}
            onFile={(f) => void onFile(0, f)}
            onRemove={() => onRemove(0)}
          />
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              aria-label={t.swapLabel}
              onClick={onSwap}
              className="flex size-9 items-center justify-center rounded-full border border-gray-300 text-gray-600 hover:border-gray-500 hover:bg-gray-50"
            >
              <IconArrowsExchange size={18} className="rotate-90 sm:rotate-0" />
            </button>
            <span className="text-[11px] text-gray-400">{t.swap}</span>
          </div>
          <BookSlot
            position={2}
            state={second}
            onFile={(f) => void onFile(1, f)}
            onRemove={() => onRemove(1)}
          />
        </div>

        <div className="mt-7">
          <LayoutPicker
            layout={layout}
            onChange={onLayout}
            firstName={nameOf(first, 1)}
            secondName={nameOf(second, 2)}
          />
        </div>

        <div className="mt-7 text-center">
          <button
            type="button"
            disabled={!bothReady || merge.status === 'running'}
            onClick={() => void onMerge()}
            className="h-11 rounded-lg bg-blue-600 px-10 text-base font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {merge.status === 'running' ? t.merging : t.start}
          </button>
          <p className="mt-2 text-xs text-gray-400">
            {bothReady ? t.sameBookReminder : t.needBothBooks}
          </p>

          {merge.status === 'done' && (
            <div className="mt-5 flex flex-col items-center gap-2">
              <a
                href={merge.url}
                download={merge.fileName}
                className="flex items-center gap-1.5 rounded-lg border border-blue-600 px-5 py-2 text-[15px] text-blue-700 hover:bg-blue-50"
              >
                <IconDownload size={18} />
                {t.download}
              </a>
              <p className="text-xs text-gray-500">
                {t.done(merge.stats.pairs, (merge.stats.ms / 1000).toFixed(1))}
              </p>
            </div>
          )}
          {merge.status === 'error' && (
            <p className="mt-4 text-sm text-red-600">{merge.message(t)}</p>
          )}
        </div>

        <section className="mt-8 rounded-lg bg-gray-50 px-5 py-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <IconBulb size={16} className="text-amber-600" />
            {t.tipsTitle}
          </h2>
          <ul className="grid grid-cols-1 gap-x-5 gap-y-1.5 text-[13px] text-gray-600 sm:grid-cols-2">
            {t.tips.map((tip) => (
              <li key={tip} className="flex items-start gap-1.5">
                <IconCheck size={15} className="mt-0.5 shrink-0 text-green-600" />
                {tip}
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-8 flex justify-center gap-4 border-t border-gray-200 pt-4 text-xs text-gray-400">
          <span>{t.footerPrivacy}</span>
          <span>·</span>
          <span>{t.footerPersonalUse}</span>
          <span>·</span>
          <span>GitHub</span>
        </footer>
      </main>
    </div>
  );
}
