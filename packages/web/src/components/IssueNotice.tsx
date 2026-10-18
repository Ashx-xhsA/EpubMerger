import { IconAlertCircle, IconAlertTriangle, IconInfoCircle } from '@tabler/icons-react';

interface Props {
  /** error = 不能合并（红），warning = 可以"仍然继续"（黄），info = 没有问题时的提醒（蓝） */
  level: 'error' | 'warning' | 'info';
  messages: string[];
}

const STYLES = {
  error: { box: 'border-red-200 bg-red-50 text-red-800', Icon: IconAlertCircle },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', Icon: IconAlertTriangle },
  info: { box: 'border-blue-100 bg-blue-50 text-blue-800', Icon: IconInfoCircle },
};

/** 合并按钮上方的提示框：语言组合的问题，或者"请确认是同一本书" */
export function IssueNotice({ level, messages }: Props) {
  const { box, Icon } = STYLES[level];
  return (
    <div
      role={level === 'info' ? 'note' : 'alert'}
      className={`mx-auto mb-4 flex max-w-xl items-start gap-2 rounded-lg border px-4 py-2.5 text-left text-[13px] ${box}`}
    >
      <Icon size={17} className="mt-px shrink-0" />
      <div className="flex flex-col gap-1">
        {messages.map((m) => (
          <p key={m}>{m}</p>
        ))}
      </div>
    </div>
  );
}
