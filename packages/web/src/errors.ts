// 意外错误上报（Sentry）。只报程序没想到的错；"不是 ePub""有 DRM"这类已知问题只在统计里记错误码。
// 报告里不能有书的内容：不记点击和控制台（面包屑），不带网址的 # 和 ?，去掉附加数据，报错信息截短
// 改了上报的内容，记得同步改隐私说明里的"错误报告"（strings/legal-*.ts）

import {
  dedupeIntegration,
  globalHandlersIntegration,
  init,
  captureException,
} from '@sentry/browser';
import type { ErrorEvent } from '@sentry/browser';

/** Sentry 项目的 DSN。空着时什么都不发 */
const SENTRY_DSN: string =
  'https://3df02c9d16e7b4cc7f4fe9e39c30ea73@o4512285011148800.ingest.us.sentry.io/4512291550199808';
const MAX_MESSAGE = 300;

let enabled = false;

/** 只在线上构建、填了 DSN 时开启 */
export function initErrors(): void {
  if (!import.meta.env.PROD || SENTRY_DSN === '') return;
  init({
    dsn: SENTRY_DSN,
    // 默认的一组功能里有面包屑（记录点击、控制台），会带上页面上的字。只留两样：
    // 没人接住的错误自动上报、同一个错误连着出现只报一次
    defaultIntegrations: false,
    integrations: [globalHandlersIntegration(), dedupeIntegration()],
    maxBreadcrumbs: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
  enabled = true;
}

/** 在哪一步出的错，方便在 Sentry 后台分类 */
export type ErrorStage = 'load' | 'chapters' | 'merge';

/** 上报一个意外错误。开发时只在控制台打印 */
export function reportUnexpected(error: unknown, stage: ErrorStage): void {
  if (!enabled) {
    if (import.meta.env.DEV) console.debug('[errors]', stage, error);
    return;
  }
  // Worker 有时只传回报错的文字，包成 Error 才有类型和堆栈
  const err = error instanceof Error ? error : new Error(String(error));
  captureException(err, { tags: { stage } });
}

const cut = (text: string) => (text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text);

/** 发出去之前最后过一遍：去掉可能带书内容的部分 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.breadcrumbs;
  delete event.extra;
  delete event.user;
  if (event.request !== undefined) {
    const { url } = event.request;
    event.request = url === undefined ? {} : { url: url.split(/[?#]/)[0] };
  }
  if (event.message !== undefined) event.message = cut(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value !== undefined) exception.value = cut(exception.value);
  }
  return event;
}
