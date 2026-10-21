import {
  IconArrowsExchange,
  IconBulb,
  IconCheck,
  IconDownload,
  IconLoader2,
  IconLock,
} from '@tabler/icons-react';
import { checkLanguagePair, MAX_FILE_BYTES } from '@epubmerger/core';
import type { LanguageIssue } from '@epubmerger/core';
import { useEffect, useRef, useState } from 'react';
import { charsBucket, countDownload, sizeBucket, track } from './analytics.ts';
import { prefillFromRange, sameRange } from './bodyRange.ts';
import { reportUnexpected } from './errors.ts';
import { changedSections, componentProblems, components, groupsFromLinks } from './chapterTable.ts';
import type { Empties, Link } from './chapterTable.ts';
import { BodyRange } from './components/BodyRange.tsx';
import { BookSlot } from './components/BookSlot.tsx';
import type { SlotIssue, SlotState } from './components/BookSlot.tsx';
import { ChapterTable } from './components/ChapterTable.tsx';
import { IssueNotice } from './components/IssueNotice.tsx';
import { LanguageSwitch } from './components/LanguageSwitch.tsx';
import { LayoutPicker } from './components/LayoutPicker.tsx';
import type {
  BodyRange as Range,
  Layout,
  MergeProgress,
  MergeStats,
  PreparedChapters,
} from './pipeline.ts';
import { languageName, useLocale } from './strings/index.tsx';
import type { LoadErrorCode, Strings } from './strings/en.ts';
import { call, callback, cancel, CANCELLED } from './worker-client.ts';

const REPO_URL = 'https://github.com/Ashx-xhsA/EpubMerger';

type MergeState =
  | { status: 'idle' }
  /** progress 是 null 时还没收到 Worker 的第一条进度 */
  | { status: 'running'; progress: MergeProgress | null }
  /** 用户点了"取消"；交换、换书这类操作顺带取消的不算，直接回到 idle */
  | { status: 'cancelled' }
  | { status: 'done'; url: string; fileName: string; stats: MergeStats }
  /** 错误提示是按当前界面语言生成文字的函数，切换语言后跟着变 */
  | { status: 'error'; message: (t: Strings) => string };

/** 第二步的表：按哪个正文范围预填的；initial 是预填的那一版（"恢复预填"用），links 是用户改过的 */
interface MatchTable {
  range: Range;
  initial: Link[];
  links: Link[];
}

/**
 * 章节的两步（1.6）：第一步选正文首尾，第二步改章节表。key 是"第一本 id > 第二本 id"，
 * 交换、换书后 key 变了，旧的就不用了，回到第一步重新猜
 */
type ReadyChapters = {
  key: string;
  status: 'ready';
  info: PreparedChapters;
  step: 'range' | 'table';
  /** 第一步正在选的范围；一开始是 Worker 猜的 info.range */
  range: Range;
  /** 第二步的表，第一次点"下一步"之前是 null */
  matched: MatchTable | null;
  /** 改了正文范围、重新预填之前的那张表，撤销用。用户动了新表、或者回到第一步就清掉 */
  previous: MatchTable | null;
};
type ChapterState = ReadyChapters | { key: string; status: 'error'; message: string };

let nextId = 0;

const coverUrls = (slots: SlotState[]) =>
  slots.flatMap((s) => (s.status === 'ready' && s.coverUrl !== null ? [s.coverUrl] : []));

type ReadySlot = Extract<SlotState, { status: 'ready' }>;

/** 语言问题的完整说明。书名用问题挂着的那本；两本一起的问题（SAME_LANGUAGE）不用书名 */
const issueDetail = (t: Strings, issue: LanguageIssue, books: [ReadySlot, ReadySlot]) => {
  const book = issue.bookSide === 'b' ? books[1] : books[0];
  return t.languageIssues[issue.code].detail(languageName(t, issue.lang ?? ''), book.summary.title);
};

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
  /** 点过"仍然继续"的那两本书（两个 id 排好序），换了书就不算数；交换不影响 */
  const [continuedFor, setContinuedFor] = useState<string | null>(null);
  const [chapters, setChapters] = useState<ChapterState | null>(null);
  /** 已经让 Worker 去准备章节表的 key，避免每次渲染都重复调用 */
  const requested = useRef<string | null>(null);

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
    const report = (result: 'ok' | LoadErrorCode, lang = 'und') =>
      track({ name: 'book_loaded', result, lang, size: sizeBucket(file.size) });
    setSlots((current) => {
      const copy: typeof current = [...current];
      copy[index] = { status: 'loading', id, fileName: file.name };
      return copy;
    });
    // 太大的文件不读进内存：读进来再复制给 Worker 会很慢，甚至让页面崩掉。上限和 core 用同一个
    if (file.size > MAX_FILE_BYTES) {
      report('TOO_LARGE');
      return updateSlot(id, { status: 'error', id, fileName: file.name, code: 'TOO_LARGE' });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let result;
    try {
      // 复制一份给 Worker，自己留着 bytes，合并时还要用
      result = await call((api) => api.loadBook(bytes, file.name));
    } catch (error) {
      // core 没有返回错误码、而是直接抛错（多半是 core 的 bug）。不然这个框会一直转圈
      console.error(error);
      reportUnexpected(error, 'load');
      report('UNEXPECTED');
      return updateSlot(id, { status: 'error', id, fileName: file.name, code: 'UNEXPECTED' });
    }
    if (result === CANCELLED) return updateSlot(id, { status: 'empty' });
    if (!result.ok) {
      report(result.code);
      return updateSlot(id, { status: 'error', id, fileName: file.name, code: result.code });
    }
    const { cover, language } = result.summary;
    report('ok', language.kind === 'single' ? language.lang : 'und');
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
  const bothEmpty = first.status === 'empty' && second.status === 'empty';

  // 两本都读完就检查语言组合。每次渲染时现算（不到 1 毫秒），交换、换书后自动更新
  const issues = bothReady
    ? checkLanguagePair(first.summary.language, second.summary.language).issues
    : [];
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const pairKey = bothReady ? [first.id, second.id].sort((x, y) => x - y).join('-') : null;
  const needsContinue = warnings.length > 0 && errors.length === 0 && continuedFor !== pairKey;

  // 两本读好、语言没有 error 时准备章节表。顺序也算进 key：交换后第一本变了，表要重新预填
  const orderKey = bothReady && errors.length === 0 ? `${first.id}>${second.id}` : null;
  useEffect(() => {
    const [a, b] = slots;
    if (orderKey === null || requested.current === orderKey) return;
    if (a.status !== 'ready' || b.status !== 'ready') return;
    requested.current = orderKey;
    const key = orderKey;
    call((api) =>
      api.prepareChapters(
        { bytes: a.bytes, fileName: a.fileName },
        { bytes: b.bytes, fileName: b.fileName },
      ),
    ).then(
      (result) => {
        if (result === CANCELLED) {
          // Worker 被换掉了（取消合并），下次渲染时重新请求
          if (requested.current === key) requested.current = null;
        } else if (!result.ok) {
          reportUnexpected(result.message, 'chapters');
          setChapters({ key, status: 'error', message: result.message });
        } else {
          const info = result.chapters;
          setChapters({
            key,
            status: 'ready',
            info,
            step: 'range',
            range: info.range,
            matched: null,
            previous: null,
          });
        }
      },
      (error: unknown) => {
        console.error(error);
        reportUnexpected(error, 'chapters');
        setChapters({ key, status: 'error', message: String(error) });
      },
    );
  }, [orderKey, slots]);

  /** 当前这两本书（按现在的顺序）的章节表；还在准备时是 null */
  const table = chapters !== null && chapters.key === orderKey ? chapters : null;
  const empties = (info: PreparedChapters): Empties => ({
    first: info.first.map((s) => s.empty),
    second: info.second.map((s) => s.empty),
  });
  const chaptersReady =
    table?.status === 'ready' &&
    table.step === 'table' &&
    table.matched !== null &&
    componentProblems(components(table.matched.links, empties(table.info))).length === 0;

  const updateChapters = (update: (c: ReadyChapters) => ReadyChapters) =>
    setChapters((c) => (c?.status === 'ready' ? update(c) : c));

  /** 第一步点"下一步"：范围没变就回到原来的表；变了就按新范围重新预填，旧表留着撤销用 */
  const onNext = () => {
    if (table?.status !== 'ready') return;
    const { matched, range, info } = table;
    track({
      name: 'range_confirmed',
      startChanged: range.from.en !== info.range.from.en || range.from.zh !== info.range.from.zh,
      endChanged: range.to.en !== info.range.to.en || range.to.zh !== info.range.to.zh,
    });
    if (matched !== null && sameRange(matched.range, range)) {
      updateChapters((c) => ({ ...c, step: 'table' }));
      return;
    }
    resetMerge();
    const initial = prefillFromRange(info, range);
    updateChapters((c) => ({
      ...c,
      step: 'table',
      matched: { range, initial, links: initial },
      previous: c.matched,
    }));
  };

  /** 撤销重新预填：回到旧的范围和旧的表 */
  const onUndoRefill = () => {
    resetMerge();
    updateChapters((c) =>
      c.previous === null
        ? c
        : { ...c, range: c.previous.range, matched: c.previous, previous: null },
    );
  };

  /** 改了章节表：之前的合并结果作废 */
  const onLinks = (links: Link[]) => {
    resetMerge();
    updateChapters((c) =>
      c.matched === null ? c : { ...c, matched: { ...c.matched, links }, previous: null },
    );
  };

  /** 表上方那一行：两本书各自的正文首尾 */
  const rangeLine = (c: ReadyChapters, range: Range) => {
    const span = (sections: PreparedChapters['first'], from: number, to: number) =>
      t.chapters.rangeSpan(sections[from]?.title ?? '', sections[to]?.title ?? '');
    return t.chapters.rangeLine(
      span(c.info.first, range.from.en, range.to.en),
      span(c.info.second, range.from.zh, range.to.zh),
    );
  };

  /** 这张卡片上的问题：挂在这本或两本上的，error 优先 */
  const slotIssue = (side: 'a' | 'b'): SlotIssue | null => {
    const issue = [...errors, ...warnings].find(
      (i) => i.bookSide === side || i.bookSide === 'both',
    );
    if (issue === undefined) return null;
    const label = t.languageIssues[issue.code].label(languageName(t, issue.lang ?? ''));
    return { level: issue.level, label };
  };

  const onMerge = async () => {
    if (first.status !== 'ready' || second.status !== 'ready') return;
    if (table?.status !== 'ready' || table.matched === null) return;
    const groups = groupsFromLinks(table.matched.links, empties(table.info), {
      first: table.info.first.length,
      second: table.info.second.length,
    });
    resetMerge();
    setMerge({ status: 'running', progress: null });
    track({
      name: 'merge_started',
      sectionsChanged: changedSections(table.matched.initial, table.matched.links),
      layout,
    });
    const startedAt = performance.now();
    const onProgress = (progress: MergeProgress) =>
      setMerge((m) => (m.status === 'running' ? { status: 'running', progress } : m));
    const result = await call((api) =>
      api.mergeBooks(
        { bytes: first.bytes, fileName: first.fileName },
        { bytes: second.bytes, fileName: second.fileName },
        { layout, groups },
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
      const chars = [...table.info.first, ...table.info.second].reduce((n, s) => n + s.chars, 0);
      track({
        name: 'merge_done',
        seconds: Math.round((performance.now() - startedAt) / 100) / 10,
        chars: charsBucket(chars),
        layout,
      });
    } else if ('issues' in result) {
      // 正常情况下到不了这里：有 error 时按钮已经按不了
      const issue = result.issues.find((i) => i.level === 'error') ?? result.issues[0]!;
      track({ name: 'merge_failed', code: 'LANGUAGE' });
      const books: [ReadySlot, ReadySlot] = [first, second];
      setMerge({ status: 'error', message: (t) => issueDetail(t, issue, books) });
    } else {
      track({ name: 'merge_failed', code: 'UNEXPECTED' });
      const { message } = result;
      reportUnexpected(message, 'merge');
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
          <h1 className="flex items-center justify-center gap-2 text-[28px] font-medium">
            <img src="/favicon.svg" alt="" className="size-8" />
            EpubMerger
          </h1>
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
            layout={layout}
            issue={slotIssue('a')}
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
            layout={layout}
            issue={slotIssue('b')}
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

        {bothReady && errors.length === 0 && (
          <div className="mt-7">
            {[first, second].flatMap((slot) => {
              const { warning, count } = slot.summary.chapters;
              return warning === null
                ? []
                : [
                    <IssueNotice
                      key={slot.id}
                      level="warning"
                      messages={[t.tocNotice[warning](slot.summary.title, count)]}
                    />,
                  ];
            })}
            {table === null ? (
              <p className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500">
                <IconLoader2 size={18} className="animate-spin" />
                {t.chapters.preparing}
              </p>
            ) : table.status === 'error' ? (
              <p className="py-4 text-center text-sm text-red-600">
                {t.chapters.prepareFailed(table.message)}
              </p>
            ) : table.step === 'range' || table.matched === null ? (
              <BodyRange
                first={table.info.first}
                second={table.info.second}
                firstTitle={first.summary.title}
                secondTitle={second.summary.title}
                range={table.range}
                guessed={table.info.range}
                onChange={(range) => updateChapters((c) => ({ ...c, range }))}
              />
            ) : (
              <ChapterTable
                first={table.info.first}
                second={table.info.second}
                firstTitle={first.summary.title}
                secondTitle={second.summary.title}
                links={table.matched.links}
                onChange={onLinks}
                onRestore={() => onLinks(table.matched!.initial)}
                rangeLine={rangeLine(table, table.matched.range)}
                onEditRange={() => updateChapters((c) => ({ ...c, step: 'range', previous: null }))}
                refilled={table.previous === null ? null : { onUndo: onUndoRefill }}
              />
            )}
          </div>
        )}

        <div className="mt-7 text-center">
          {bothReady &&
            (errors.length > 0 ? (
              <IssueNotice
                level="error"
                messages={errors.map((i) => issueDetail(t, i, [first, second]))}
              />
            ) : warnings.length > 0 ? (
              <IssueNotice
                level="warning"
                messages={warnings.map((i) => issueDetail(t, i, [first, second]))}
              />
            ) : (
              <IssueNotice level="info" messages={[t.sameBookReminder]} />
            ))}
          <div className="flex items-center justify-center gap-2">
            {table?.status === 'ready' && (table.step === 'range' || table.matched === null) ? (
              <button
                type="button"
                onClick={onNext}
                className="h-11 rounded-lg bg-blue-600 px-10 text-base font-medium text-white hover:bg-blue-700"
              >
                {t.range.next}
              </button>
            ) : needsContinue ? (
              <button
                type="button"
                disabled={!chaptersReady}
                onClick={() => {
                  setContinuedFor(pairKey);
                  void onMerge();
                }}
                className="h-11 rounded-lg border-[1.5px] border-amber-500 bg-white px-10 text-base font-medium text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t.continueAnyway}
              </button>
            ) : (
              <button
                type="button"
                disabled={
                  !bothReady || errors.length > 0 || !chaptersReady || merge.status === 'running'
                }
                onClick={() => void onMerge()}
                className="h-11 rounded-lg bg-blue-600 px-10 text-base font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {merge.status === 'running' ? progressText(t, merge.progress) : t.start}
              </button>
            )}
            {merge.status === 'running' && (
              <button
                type="button"
                onClick={() => {
                  track({ name: 'merge_cancelled', stage: merge.progress?.stage ?? 'starting' });
                  cancel();
                  setMerge({ status: 'cancelled' });
                }}
                className="h-11 rounded-lg border border-gray-300 px-4 text-[15px] text-gray-700 hover:bg-gray-50"
              >
                {t.cancel}
              </button>
            )}
          </div>
          {!bothReady && <p className="mt-2 text-xs text-gray-400">{t.needBothBooks}</p>}

          {merge.status === 'done' && (
            <div className="mt-5 flex flex-col items-center gap-2">
              <a
                href={merge.url}
                download={merge.fileName}
                onClick={() => track({ name: 'download', nth: countDownload(() => localStorage) })}
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

        {bothEmpty && (
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
        )}

        <footer className="mt-8 flex justify-center gap-4 border-t border-gray-200 pt-4 text-xs text-gray-400">
          {/* 说明页在新标签页打开，这一页读好的书和章节表不会丢 */}
          <a href="#privacy" target="_blank" className="hover:text-gray-700">
            {t.footerPrivacy}
          </a>
          <span>·</span>
          <a href="#terms" target="_blank" className="hover:text-gray-700">
            {t.footerTerms}
          </a>
          <span>·</span>
          <a
            href={`${REPO_URL}/issues`}
            target="_blank"
            rel="noreferrer"
            className="hover:text-gray-700"
          >
            {t.footerIssues}
          </a>
          <span>·</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-gray-700">
            GitHub
          </a>
        </footer>
      </main>
    </div>
  );
}
