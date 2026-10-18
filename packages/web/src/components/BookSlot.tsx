import { IconAlertCircle, IconBook, IconLoader2, IconPlus, IconX } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { BookSummary, Layout } from '../pipeline.ts';
import type { LoadErrorCode } from '../strings/en.ts';
import { languageName, useLocale } from '../strings/index.tsx';

/**
 * 一个上传框的状态。id 用来认出"读完的是哪次上传"，读的时候交换或移除也不会放错位置。
 * bytes 留在主线程：Worker 不保存书，合并时再传过去
 */
export type SlotState =
  | { status: 'empty' }
  | { status: 'loading'; id: number; fileName: string }
  | {
      status: 'ready';
      id: number;
      fileName: string;
      bytes: Uint8Array;
      summary: BookSummary;
      /** 封面的临时网址（blob:），由 App 生成和释放；没有封面时是 null */
      coverUrl: string | null;
    }
  | { status: 'error'; id: number; fileName: string; code: LoadErrorCode };

/** 语言组合检查挂在这本书上的问题，App 算好、已经按界面语言写成文字 */
export interface SlotIssue {
  level: 'error' | 'warning';
  /** 显示在语言标签里，例如"简体中文 · 两本相同" */
  label: string;
}

interface Props {
  /** 1 = 排在前面（蓝色），2 = 排在后面（灰色） */
  position: 1 | 2;
  state: SlotState;
  /** 排版：左右两栏时标签写"排在左边 / 右边"，上下交替时写"排在前面 / 后面" */
  layout: Layout;
  /** 没有问题时是 null，这时标签显示识别出的语言 */
  issue: SlotIssue | null;
  /** 拖进来或选中的所有文件。一次给两本时，App 把它们分到两个框 */
  onFiles: (files: File[]) => void;
  onRemove: () => void;
}

export function BookSlot({ position, state, layout, issue, onFiles, onRemove }: Props) {
  const { t } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const first = position === 1;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length > 0) onFiles(files);
  };

  const border =
    state.status === 'error' || issue?.level === 'error'
      ? 'border-red-500'
      : issue?.level === 'warning'
        ? 'border-amber-500'
        : state.status === 'ready'
          ? first
            ? 'border-blue-600'
            : 'border-gray-400'
          : 'border-dashed border-gray-300 hover:border-gray-500';

  const tag =
    issue?.level === 'error'
      ? 'bg-red-50 text-red-700'
      : issue?.level === 'warning'
        ? 'bg-amber-50 text-amber-800'
        : first
          ? 'bg-blue-50 text-blue-700'
          : 'bg-gray-100 text-gray-600';

  return (
    <div
      className={`relative flex h-64 cursor-pointer flex-col items-center justify-center rounded-xl border-[1.5px] px-4 text-center transition-colors ${border} ${dragging ? 'bg-blue-50' : 'bg-white'}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={input}
        type="file"
        accept=".epub,application/epub+zip"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length > 0) onFiles(files);
          e.target.value = '';
        }}
      />

      <div
        className={`absolute top-3 left-3 flex items-center gap-1.5 text-xs ${first ? 'text-blue-700' : 'text-gray-500'}`}
      >
        <span
          className={`flex size-[18px] items-center justify-center rounded-full text-[11px] ${first ? 'bg-blue-600 text-white' : 'border border-gray-400'}`}
        >
          {position}
        </span>
        {layout === 'columns'
          ? first
            ? t.slotLeft
            : t.slotRight
          : first
            ? t.slotFirst
            : t.slotSecond}
      </div>

      {state.status !== 'empty' && (
        <button
          type="button"
          aria-label={t.remove}
          className="absolute top-2.5 right-2.5 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <IconX size={16} />
        </button>
      )}

      {state.status === 'empty' && (
        <>
          <IconPlus size={44} stroke={1.5} className="text-gray-500" />
          <p className="mt-2 text-[15px] text-gray-900">{t.dropHint}</p>
          <p className="mt-1 text-xs text-gray-400">{t.dropSub}</p>
        </>
      )}

      {state.status === 'loading' && (
        <>
          <IconLoader2 size={32} className="animate-spin text-gray-400" />
          <p className="mt-2 text-sm text-gray-500">{t.reading}</p>
          <p className="mt-1 max-w-full truncate text-xs text-gray-400">{state.fileName}</p>
        </>
      )}

      {state.status === 'error' && (
        <>
          <IconAlertCircle size={32} stroke={1.5} className="text-red-500" />
          <p className="mt-2 text-[15px] font-medium text-red-700">
            {t.parseErrors[state.code].title}
          </p>
          <p className="mt-1 text-[13px] text-gray-600">{t.parseErrors[state.code].hint}</p>
          <p className="mt-2 max-w-full truncate text-xs text-gray-400">{state.fileName}</p>
        </>
      )}

      {state.status === 'ready' && (
        <>
          <CoverImage key={state.coverUrl} url={state.coverUrl} first={first} />
          <p className="mt-2 line-clamp-2 text-[15px] font-medium text-gray-900">
            {state.summary.title}
          </p>
          <p className="max-w-full truncate text-[13px] text-gray-500">
            {state.summary.authors.join(', ')}
          </p>
          <span className={`mt-1.5 rounded-md px-2.5 py-0.5 text-xs ${tag}`}>
            {issue?.label ??
              (state.summary.language.kind === 'single'
                ? languageName(t, state.summary.language.lang)
                : t.languageUnclear)}
          </span>
        </>
      )}
    </div>
  );
}

/** 封面。没有封面、或者图片坏了，显示书本图标。key 是网址，换书时 broken 自动重置 */
function CoverImage({ url, first }: { url: string | null; first: boolean }) {
  const [broken, setBroken] = useState(false);
  if (url === null || broken) {
    return (
      <div
        className={`flex h-[104px] w-[72px] items-center justify-center rounded ${first ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}
      >
        <IconBook size={26} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      onError={() => setBroken(true)}
      className="h-[104px] w-[72px] rounded border border-gray-200 object-cover shadow-sm"
    />
  );
}
