import { IconChevronUp, IconDots } from '@tabler/icons-react';
import { useState } from 'react';
import {
  endOf,
  sameRange,
  setEnd,
  setStart,
  startOf,
  visibleRows,
  type Side,
} from '../bodyRange.ts';
import type { BodyRange as Range, SectionInfo } from '../pipeline.ts';
import { useLocale } from '../strings/index.tsx';

interface Props {
  first: SectionInfo[];
  second: SectionInfo[];
  firstTitle: string;
  secondTitle: string;
  range: Range;
  /** Worker 猜的那一版（"恢复我们猜的"用） */
  guessed: Range;
  onChange: (range: Range) => void;
}

/**
 * 第一步：两本书各自选正文的开头和结尾（1.6）。两栏互相独立，不用左右配对。
 * 每张卡片下面两个小按钮"开头""结尾"，点了就生效，没有选中状态。首尾之间是蓝色，之外是灰色虚线框。
 * 这一步只关心首尾，中间的节折成一行
 */
export function BodyRange({
  first,
  second,
  firstTitle,
  secondTitle,
  range,
  guessed,
  onChange,
}: Props) {
  const { t } = useLocale();
  const r = t.range;
  const [expanded, setExpanded] = useState(false);

  const column = (side: Side, sections: SectionInfo[], title: string) => {
    const start = startOf(range, side);
    const end = endOf(range, side);
    const rows = visibleRows(sections, start, end, { expanded });

    const card = (index: number) => {
      const s = sections[index]!;
      const inside = index >= start && index <= end;
      const pill = (label: string, on: boolean, onClick: () => void) => (
        <button
          type="button"
          aria-pressed={on}
          onClick={onClick}
          className={`rounded-full border px-2 py-px text-[11px] sm:text-xs ${
            on
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-300 bg-white text-gray-500 hover:border-blue-500 hover:text-blue-700'
          }`}
        >
          {label}
        </button>
      );
      return (
        <div
          key={index}
          style={{ marginLeft: `${Math.min(s.depth, 3) * 8}px` }}
          className={`min-w-0 rounded-lg border px-2.5 py-1.5 sm:px-3 ${
            inside ? 'border-blue-300 bg-blue-50' : 'border-dashed border-gray-300 bg-white'
          }`}
        >
          <span
            className={`line-clamp-2 text-[13px] break-words sm:text-sm ${inside ? 'text-gray-900' : 'text-gray-500'}`}
          >
            {s.title}
          </span>
          <span className="mt-0.5 flex gap-1.5 text-[11px] text-gray-400 sm:text-xs">
            <span className="shrink-0">{t.chapters.chars(s.chars)}</span>
            {!inside && <span className="shrink-0">· {r.outside}</span>}
          </span>
          {s.preview !== '' && (
            <span className="mt-0.5 line-clamp-2 text-[11px] text-gray-500 sm:text-xs">
              {s.preview}
            </span>
          )}
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {pill(r.start, index === start, () => onChange(setStart(range, side, index)))}
            {pill(r.end, index === end, () => onChange(setEnd(range, side, index)))}
          </span>
        </div>
      );
    };

    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="truncate pb-1 text-xs text-gray-500">{title}</span>
        {rows.map((row) =>
          row.kind === 'section' ? (
            card(row.index)
          ) : (
            <button
              key={`gap-${row.indices[0]}`}
              type="button"
              onClick={() => setExpanded(true)}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/50 px-2 py-2 text-[12px] text-blue-700 hover:bg-blue-50 sm:text-[13px]"
            >
              <IconDots size={15} />
              {r.gap(row.indices.length)}
            </button>
          ),
        )}
      </div>
    );
  };

  return (
    <section className="rounded-xl border border-gray-200">
      <header className="flex items-start gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-medium">{r.title}</h2>
          <p className="mt-0.5 text-[13px] text-gray-500">{r.hint}</p>
        </div>
        {!sameRange(range, guessed) && (
          <button
            type="button"
            onClick={() => onChange(guessed)}
            className="shrink-0 rounded-md px-2 py-1 text-[13px] text-blue-700 hover:bg-blue-50"
          >
            {r.restore}
          </button>
        )}
      </header>
      <div className="max-h-[640px] overflow-y-auto px-3 py-3 sm:px-4">
        <div className="grid grid-cols-2 gap-3 sm:gap-6">
          {column('first', first, firstTitle)}
          {column('second', second, secondTitle)}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-gray-200 px-4 py-2.5 text-xs">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="flex items-center gap-0.5 text-blue-700 hover:underline"
          >
            <IconChevronUp size={14} />
            {r.collapseGap}
          </button>
        </div>
      )}
    </section>
  );
}
