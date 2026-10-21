import { IconAlertCircle, IconChevronDown, IconChevronUp, IconX } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  componentProblems,
  components,
  groupsFromLinks,
  linkPair,
  unpairGroup,
  type Empties,
  type Link,
} from '../chapterTable.ts';
import type { SectionInfo } from '../pipeline.ts';
import { useLocale } from '../strings/index.tsx';

interface Props {
  first: SectionInfo[];
  second: SectionInfo[];
  firstTitle: string;
  secondTitle: string;
  links: Link[];
  onChange: (links: Link[]) => void;
  /** 回到程序预填的那一版 */
  onRestore: () => void;
  /** 表上方那一行：两本书的正文范围 */
  rangeLine: string;
  /** 回到第一步改正文范围 */
  onEditRange: () => void;
  /** 改了正文范围、表重新预填过：状态栏说一句，可以撤销（回到旧的范围和旧的表） */
  refilled: { onUndo: () => void } | null;
}

type Side = keyof Link;

/** 上一次操作，用来显示提示和撤销。before 是操作之前的连线 */
type LastAction =
  | { kind: 'paired'; first: number; second: number; dropped: number; before: Link[] }
  | { kind: 'unpaired'; before: Link[] };

/**
 * 章节对照表：两列卡片，左边第一本、右边第二本（trade-off 032）。
 * 点一边的一张卡片选中它，再点另一边的一张就配成一对，选中随即消失。最后一次操作说了算：
 * 和它冲突的旧配对会被去掉，所以表永远是合法的。按组排成一行一行，配上的是蓝色、中间一条线，
 * 点线上的 × 拆开；没配上的是灰色虚线框
 */
export function ChapterTable({
  first,
  second,
  firstTitle,
  secondTitle,
  links,
  onChange,
  onRestore,
  rangeLine,
  onEditRange,
  refilled,
}: Props) {
  const { t } = useLocale();
  const c = t.chapters;
  const [open, setOpen] = useState(true);
  const [showEmpty, setShowEmpty] = useState(false);
  const [selected, setSelected] = useState<{ side: Side; index: number } | null>(null);
  const [last, setLast] = useState<LastAction | null>(null);
  const list = useRef<HTMLDivElement>(null);

  const empties: Empties = { first: first.map((s) => s.empty), second: second.map((s) => s.empty) };
  const sections = { first, second };
  // 正常情况下不会有问题（linkPair 保证合法），只是兜底：比如以后预填出了不合法的表
  const problems = componentProblems(components(links, empties));

  /** 按组排成一行一行：同一组左右两边的卡片在同一行；没配上的节自己占一行。顺序是书的顺序 */
  const rows = groupsFromLinks(links, empties, { first: first.length, second: second.length })
    .map((g) => ({
      paired: g.en.length > 0 && g.zh.length > 0,
      group: { first: g.en, second: g.zh },
      first: g.en.filter((i) => showEmpty || !empties.first[i]),
      second: g.zh.filter((j) => showEmpty || !empties.second[j]),
    }))
    .filter((r) => r.first.length > 0 || r.second.length > 0);

  // 刚配好的那一行滚到看得见的地方
  useEffect(() => {
    if (last?.kind === 'paired') {
      list.current
        ?.querySelector('[data-changed]')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [last]);

  const onCard = (side: Side, index: number) => {
    if (selected === null || selected.side === side) {
      setSelected(selected?.side === side && selected.index === index ? null : { side, index });
      return;
    }
    const [i, j] = side === 'second' ? [selected.index, index] : [index, selected.index];
    const result = linkPair(links, i, j, empties);
    setSelected(null);
    setLast({ kind: 'paired', first: i, second: j, dropped: result.dropped, before: links });
    onChange(result.links);
  };

  const card = (side: Side, index: number, paired: boolean) => {
    const s = sections[side][index]!;
    const isSelected = selected?.side === side && selected.index === index;
    const frame = isSelected
      ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-400'
      : paired
        ? 'border-blue-300 bg-blue-50 hover:border-blue-500'
        : 'border-dashed border-gray-300 bg-white hover:border-gray-500';
    return (
      <button
        key={index}
        type="button"
        disabled={s.empty}
        aria-pressed={isSelected}
        onClick={() => onCard(side, index)}
        style={{ marginLeft: `${Math.min(s.depth, 3) * 8}px` }}
        className={`min-w-0 rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 ${frame}`}
      >
        <span
          className={`line-clamp-2 text-[13px] break-words sm:text-sm ${paired || isSelected ? 'text-gray-900' : 'text-gray-500'}`}
        >
          {s.title}
        </span>
        <span className="mt-0.5 flex gap-1.5 text-[11px] text-gray-400 sm:text-xs">
          <span className="shrink-0">{s.empty ? c.emptySection : c.chars(s.chars)}</span>
          {!paired && !s.empty && (
            <span className="shrink-0">· {side === 'first' ? c.originalOnly : c.leftOut}</span>
          )}
        </span>
        {s.preview !== '' && (
          <span className="mt-0.5 line-clamp-2 text-[11px] text-gray-500 sm:text-xs">
            {s.preview}
          </span>
        )}
      </button>
    );
  };

  const selectedSection = selected === null ? undefined : sections[selected.side][selected.index];
  const titleOf = (side: Side, index: number) => sections[side][index]?.title ?? '';
  const emptyCount = empties.first.filter(Boolean).length + empties.second.filter(Boolean).length;
  const columns =
    'grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] gap-1.5 sm:grid-cols-[minmax(0,1fr)_48px_minmax(0,1fr)] sm:gap-2';

  return (
    <section className="rounded-xl border border-gray-200">
      <header className="flex items-start gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-medium">{c.title}</h2>
          {open && <p className="mt-0.5 text-[13px] whitespace-pre-line text-gray-500">{c.hint}</p>}
        </div>
        {open && (
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setLast(null);
              onRestore();
            }}
            className="shrink-0 rounded-md px-2 py-1 text-[13px] text-blue-700 hover:bg-blue-50"
          >
            {c.restore}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-0.5 rounded-md px-2 py-1 text-[13px] text-gray-600 hover:bg-gray-100"
        >
          {open ? c.collapse : c.expand}
          {open ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}
        </button>
      </header>

      {open && (
        <>
          {problems.length > 0 && (
            <p
              role="alert"
              className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-800"
            >
              <IconAlertCircle size={17} className="mt-px shrink-0" />
              {c.problems}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-100 px-4 py-2 text-[13px] text-gray-600">
            <span className="min-w-0">{rangeLine}</span>
            <button
              type="button"
              onClick={onEditRange}
              className="rounded-md px-1.5 py-0.5 text-blue-700 hover:bg-blue-50"
            >
              {c.editRange}
            </button>
          </div>

          {/* 状态栏：选中时说下一步做什么；刚改过时说改了什么，可以撤销 */}
          <div
            aria-live="polite"
            className={`flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-[13px] ${selectedSection !== undefined ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-100 text-gray-600'}`}
          >
            {selected !== null && selectedSection !== undefined ? (
              <span>{c.selected(selectedSection.title, selected.side === 'first')}</span>
            ) : last !== null ? (
              <>
                <span className="min-w-0 flex-1">
                  {last.kind === 'paired'
                    ? c.paired(
                        titleOf('first', last.first),
                        titleOf('second', last.second),
                        last.dropped,
                      )
                    : c.unpaired}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onChange(last.before);
                    setLast(null);
                  }}
                  className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100"
                >
                  {c.undo}
                </button>
              </>
            ) : refilled !== null ? (
              <>
                <span className="min-w-0 flex-1">{c.refilled}</span>
                <button
                  type="button"
                  onClick={refilled.onUndo}
                  className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-100"
                >
                  {c.undo}
                </button>
              </>
            ) : (
              <span className="text-gray-400">{c.idle}</span>
            )}
          </div>

          <div
            className={`${columns} border-b border-gray-100 px-3 py-2 text-xs text-gray-500 sm:px-4`}
          >
            <span className="truncate">{firstTitle}</span>
            <span />
            <span className="truncate">{secondTitle}</span>
          </div>
          <div ref={list} className="max-h-[640px] overflow-y-auto px-3 py-3 sm:px-4">
            <div className="flex flex-col gap-2">
              {rows.map((r) => {
                const changed =
                  last?.kind === 'paired' &&
                  r.group.first.includes(last.first) &&
                  r.group.second.includes(last.second);
                return (
                  <GroupRow
                    key={`${r.group.first.join()}|${r.group.second.join()}`}
                    className={`${columns} rounded-lg ${changed ? 'ring-2 ring-green-400 ring-offset-2' : ''}`}
                    changed={changed}
                    left={r.first.map((i) => card('first', i, r.paired))}
                    right={r.second.map((j) => card('second', j, r.paired))}
                    unpair={
                      r.paired
                        ? {
                            label: c.unpair,
                            onClick: () => {
                              setSelected(null);
                              setLast({ kind: 'unpaired', before: links });
                              onChange(unpairGroup(links, r.group));
                            },
                          }
                        : null
                    }
                  />
                );
              })}
            </div>
          </div>

          {emptyCount > 0 && (
            <div className="border-t border-gray-200 px-4 py-2.5 text-xs">
              <button
                type="button"
                onClick={() => setShowEmpty(!showEmpty)}
                className="text-blue-700 hover:underline"
              >
                {showEmpty ? c.hideEmpty : c.showEmpty(emptyCount)}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

interface GroupRowProps {
  className: string;
  changed: boolean;
  left: ReactNode[];
  right: ReactNode[];
  /** 配上的组才有：线上的 × */
  unpair: { label: string; onClick: () => void } | null;
}

interface RowParts {
  row: HTMLDivElement | null;
  left: HTMLDivElement | null;
  right: HTMLDivElement | null;
  path: SVGPathElement | null;
  button: HTMLButtonElement | null;
}

/**
 * 画配对的连线：每张卡片伸出一小段线，同一边有几张时用一条竖线收拢成括号，两边的括号在中间相连，
 * × 放在相连的地方。卡片高度要等画出来才知道，所以直接改 SVG 的属性，不经过 React 的状态
 */
function drawConnector(parts: RowParts) {
  const { row, left, right, path, button } = parts;
  if (row === null || left === null || right === null || path === null || button === null) return;
  const box = row.getBoundingClientRect();
  // 坐标取整：线宽 2 像素，落在半像素上会被抗锯齿糊开
  const cards = (cell: HTMLDivElement, edge: 'left' | 'right') =>
    [...cell.children].map((el) => {
      const r = el.getBoundingClientRect();
      const [top, bottom] = [r.top - box.top, r.bottom - box.top];
      return { x: Math.round(r[edge] - box.left), y: Math.round((top + bottom) / 2), top, bottom };
    });
  const ls = cards(left, 'right');
  const rs = cards(right, 'left');
  if (ls.length === 0 || rs.length === 0) return;
  // 一对一：两张卡片高度不同时，各自的正中间对不齐，线会拐一个小台阶。
  // 改成两张卡片上下重叠部分的中间，线是直的，而且一定碰到两张卡片
  if (ls.length === 1 && rs.length === 1) {
    const y = Math.round(
      (Math.max(ls[0]!.top, rs[0]!.top) + Math.min(ls[0]!.bottom, rs[0]!.bottom)) / 2,
    );
    ls[0]!.y = y;
    rs[0]!.y = y;
  }
  const xL = Math.round(left.getBoundingClientRect().right - box.left + 5);
  const xR = Math.round(right.getBoundingClientRect().left - box.left - 5);
  const ys = [...ls, ...rs].map((p) => p.y);
  const jy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
  const bracket = (points: { x: number; y: number }[], x: number) => {
    const top = Math.min(jy, ...points.map((p) => p.y));
    const bottom = Math.max(jy, ...points.map((p) => p.y));
    return [...points.map((p) => `M${p.x} ${p.y}H${x}`), `M${x} ${top}V${bottom}`].join('');
  };
  path.setAttribute('d', `${bracket(ls, xL)}${bracket(rs, xR)}M${xL} ${jy}H${xR}`);
  button.style.left = `${(xL + xR) / 2}px`;
  button.style.top = `${jy}px`;
}

/** 表里的一行（一组）。配上的组在左右卡片之间画括号连线 */
function GroupRow({ className, changed, left, right, unpair }: GroupRowProps) {
  const parts = useRef<RowParts>({ row: null, left: null, right: null, path: null, button: null });

  // 每次画完都重新量一次；卡片大小变了（窗口变宽变窄、换界面语言）也重新画
  useLayoutEffect(() => drawConnector(parts.current));
  useEffect(() => {
    const { row } = parts.current;
    if (row === null) return;
    const observer = new ResizeObserver(() => drawConnector(parts.current));
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={(el) => {
        parts.current.row = el;
      }}
      data-changed={changed ? '' : undefined}
      className={`relative ${className}`}
    >
      <div
        ref={(el) => {
          parts.current.left = el;
        }}
        className="flex min-w-0 flex-col gap-1.5"
      >
        {left}
      </div>
      <div />
      <div
        ref={(el) => {
          parts.current.right = el;
        }}
        className="flex min-w-0 flex-col gap-1.5"
      >
        {right}
      </div>
      {unpair !== null && (
        <>
          <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
            <path
              ref={(el) => {
                parts.current.path = el;
              }}
              className="fill-none stroke-blue-300"
              strokeWidth={2}
            />
          </svg>
          <button
            ref={(el) => {
              parts.current.button = el;
            }}
            type="button"
            title={unpair.label}
            aria-label={unpair.label}
            onClick={unpair.onClick}
            className="absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-blue-300 bg-white text-blue-600 hover:border-red-400 hover:bg-red-50 hover:text-red-600 sm:size-6"
          >
            <IconX size={12} />
          </button>
        </>
      )}
    </div>
  );
}
