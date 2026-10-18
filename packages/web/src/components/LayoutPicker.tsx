import type { ReactNode } from 'react';
import type { Layout } from '../pipeline.ts';
import { useLocale } from '../strings/index.tsx';

interface Props {
  layout: Layout;
  onChange: (layout: Layout) => void;
  /** 两本书的名字（识别出的语言，没上传时是"第 1 本"），用来说明谁在前 */
  firstName: string;
  secondName: string;
}

// 示意图里的一行字：蓝色 = 排在前面的书，灰色 = 排在后面的书，和上传框的颜色对应
const line = (first: boolean, width = '100%') => (
  <div className={`h-1.5 rounded-sm ${first ? 'bg-blue-600' : 'bg-gray-300'}`} style={{ width }} />
);

export function LayoutPicker({ layout, onChange, firstName, secondName }: Props) {
  const { t } = useLocale();

  const option = (value: Layout, label: string, caption: string, diagram: ReactNode) => {
    const selected = layout === value;
    return (
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onChange(value)}
        className={`flex w-44 flex-col items-center gap-1.5 rounded-lg px-3.5 py-2.5 ${selected ? 'border-2 border-blue-600 bg-blue-50/50' : 'border border-gray-300 hover:border-gray-500'}`}
      >
        <div className="w-20">{diagram}</div>
        <span className="text-[13px] font-medium text-gray-900">{label}</span>
        <span className="text-[11px] text-gray-500">{caption}</span>
      </button>
    );
  };

  return (
    <div className="text-center">
      <p className="mb-2 text-[13px] text-gray-500">{t.layout}</p>
      <div className="flex flex-wrap justify-center gap-2.5">
        {option(
          'stacked',
          t.stacked,
          t.stackedCaption(firstName, secondName),
          <div className="flex flex-col gap-[3px]">
            {line(true)}
            {line(false, '80%')}
            <div className="h-[3px]" />
            {line(true, '92%')}
            {line(false, '70%')}
          </div>,
        )}
        {option(
          'columns',
          t.columns,
          t.columnsCaption(firstName),
          <div className="grid grid-cols-2 gap-1">
            {[true, false].map((first) => (
              <div key={String(first)} className="flex flex-col gap-[3px]">
                {line(first)}
                {line(first, first ? '70%' : '60%')}
                <div className="h-[3px]" />
                {line(first)}
              </div>
            ))}
          </div>,
        )}
      </div>
    </div>
  );
}
