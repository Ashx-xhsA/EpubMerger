import {
  IconArrowsExchange,
  IconBulb,
  IconCheck,
  IconDownload,
  IconLock,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { BookSlot } from './components/BookSlot.tsx';
import type { SlotState } from './components/BookSlot.tsx';
import { LanguageSwitch } from './components/LanguageSwitch.tsx';
import { LayoutPicker } from './components/LayoutPicker.tsx';
import type { Layout, MergeProgress, MergeStats } from './pipeline.ts';
import { languageName, useLocale } from './strings/index.tsx';
import type { Strings } from './strings/en.ts';
import { call, callback, cancel, CANCELLED } from './worker-client.ts';

type MergeState =
  | { status: 'idle' }
  /** progress 是 null 时还没收到 Worker 的第一条进度 */
  | { status: 'running'; progress: MergeProgress | null }
  /** 用户点了"取消"；交换、换书这类操作顺带取消的不算，直接回到 idle */
  | { status: 'cancelled' }
  | { status: 'done'; url: string; fileName: string; stats: MergeStats }
  /** 错误提示是按当前界面语言生成文字的函数，切换语言后跟着变 */
  | { status: 'error'; message: (t: Strings) => string };

let nextId = 0;

const coverUrls = (slots: SlotState[]) =>
  slots.flatMap((s) => (s.status === 'ready' && s.coverUrl !== null ? [s.coverUrl] : []));

const progressText = (t: Strings, p: MergeProgress | null) =>
  p === null
    ? t.merging
    : p.stage === 'paragraphs'
      ? t.progress.paragraphs(p.done, p.total)
      : t.progress[p.stage];

export function App() {
  const { t } = useLocale();
  const [slots, setSlots] = useState<[SlotState, SlotState]>([
    { status: 'empty' },
    { status: 'empty' },
  ]);
  const [layout, setLayout] = useState<Layout>('stacked');
  const [merge, setMerge] = useState<MergeState>({ status: 'idle' });

  // 封面网址：上一次画到页面上的两个框里有、这一次没有的（移除、换书），释放掉。
  // 交换只是换位置，网址还在，不会被释放
  const committed = useRef(slots);
  useEffect(() => {
    const keep = new Set(coverUrls(slots));
    for (const url of coverUrls(committed.current)) {
      if (!keep.has(url)) URL.revokeObjectURL(url);
    }
    committed.current = slots;
  }, [slots]);

  // 文件拖到框外面放下时，浏览器默认会打开这个文件、离开我们的页面。拦掉，什么都不做
  useEffect(() => {
    const ignore = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', ignore);
    window.addEventListener('drop', ignore);
    return () => {
      window.removeEventListener('dragover', ignore);
      window.removeEventListener('drop', ignore);
    };
  }, []);

  /** 书、顺序、排版一变，之前的合并结果就作废；还在合并就取消 */
  const resetMerge = () => {
    if (merge.status === 'done') URL.revokeObjectURL(merge.url);
    if (merge.status === 'running') cancel();
    setMerge({ status: 'idle' });
  };

  /** 按 id 找到这次上传现在在哪个框里（中途可能被交换），更新它；已被移除或替换就丢掉 */
  const updateSlot = (id: number, next: SlotState) =>
    setSlots(
      (current) => current.map((s) => ('id' in s && s.id === id ? next : s)) as typeof current,
    );

  /** 一本：放进这个框。两本或更多：前两本依次放进第 1、第 2 个框，多的不要 */
  const onFiles = (index: 0 | 1, files: File[]) => {
    const [a, b] = files;
    if (a === undefined) return;
    if (b === undefined) {
      void loadInto(index, a);
    } else {
      void loadInto(0, a);
      void loadInto(1, b);
    }
  };

  const loadInto = async (index: 0 | 1, file: File) => {
    resetMerge();
    const id = nextId++;
    setSlots((current) => {
      const copy: typeof current = [...current];
      copy[index] = { status: 'loading', id, fileName: file.name };
      return copy;
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    // 复制一份给 Worker，自己留着 bytes，合并时还要用
    const result = await call((api) => api.loadBook(bytes, file.name));
    if (result === CANCELLED) return updateSlot(id, { status: 'empty' });
    if (!result.ok)
      return updateSlot(id, { status: 'error', id, fileName: file.name, code: result.code });
    const { cover } = result.summary;
    // 读的时候这个框已经被移除或换了书，就不生成网址，免得没人释放
    const stillThere = committed.current.some((s) => 'id' in s && s.id === id);
    const coverUrl =
      cover === null || !stillThere
        ? null
        : URL.createObjectURL(
            new Blob([cover.bytes as Uint8Array<ArrayBuffer>], { type: cover.mediaType }),
          );
    updateSlot(id, {
      status: 'ready',
      id,
      fileName: file.name,
      bytes,
      summary: result.summary,
      coverUrl,
    });
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
    setMerge({ status: 'running', progress: null });
    const onProgress = (progress: MergeProgress) =>
      setMerge((m) => (m.status === 'running' ? { status: 'running', progress } : m));
    const result = await call((api) =>
      api.mergeBooks(
        { bytes: first.bytes, fileName: first.fileName },
        { bytes: second.bytes, fileName: second.fileName },
        { layout },
        callback(onProgress),
      ),
    );
    // 被取消时，触发取消的那个操作已经改好了状态
    if (result === CANCELLED) return;
    if (result.ok) {
      const url = URL.createObjectURL(
        new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: 'application/epub+zip' }),
      );
      const fileName = `${first.summary.title.replace(/[\\/:*?"<>|]/g, '_')} (bilingual).epub`;
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
    slot.status === 'ready' && slot.summary.language.kind === 'single'
      ? languageName(t, slot.summary.language.lang)
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
            onFiles={(files) => onFiles(0, files)}
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
            onFiles={(files) => onFiles(1, files)}
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
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              disabled={!bothReady || merge.status === 'running'}
              onClick={() => void onMerge()}
              className="h-11 rounded-lg bg-blue-600 px-10 text-base font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {merge.status === 'running' ? progressText(t, merge.progress) : t.start}
            </button>
            {merge.status === 'running' && (
              <button
                type="button"
                onClick={() => {
                  cancel();
                  setMerge({ status: 'cancelled' });
                }}
                className="h-11 rounded-lg border border-gray-300 px-4 text-[15px] text-gray-700 hover:bg-gray-50"
              >
                {t.cancel}
              </button>
            )}
          </div>
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
          {merge.status === 'cancelled' && (
            <p className="mt-4 text-sm text-gray-500">{t.cancelled}</p>
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
