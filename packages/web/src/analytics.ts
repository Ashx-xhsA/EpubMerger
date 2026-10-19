// 匿名使用统计（Umami）。每种事件能带哪些字段在类型里写死，书名、文件名、章节名传不进来
// 改了事件，记得同步改隐私说明里"我们统计什么"（strings/legal-*.ts）

import type { Layout, MergeProgress } from './pipeline.ts';
import type { LoadErrorCode } from './strings/en.ts';

/** Umami 后台"添加网站"后给的编号。空着时什么都不发 */
const UMAMI_WEBSITE_ID: string = 'd9a24834-d64e-4a7e-8ce5-01cb884c3c9c';
const UMAMI_SCRIPT = 'https://cloud.umami.is/script.js';

export type SizeBucket = '<5MB' | '5-20MB' | '20-100MB' | '>100MB';
/** 两本书正文的总字数（不算空白）。10 万词的英文书加上中文版大约 70 万 */
export type CharsBucket = '<300k' | '300-600k' | '600k-1.2M' | '1.2M+';
/** 这个浏览器里合并下载的第几本 */
export type NthBucket = '1' | '2-5' | '6+';
/** 取消时走到了哪一步；starting 是 Worker 还没回报第一条进度 */
export type CancelStage = MergeProgress['stage'] | 'starting';

export type AnalyticsEvent =
  | { name: 'book_loaded'; result: 'ok' | LoadErrorCode; lang: string; size: SizeBucket }
  | { name: 'range_confirmed'; startChanged: boolean; endChanged: boolean }
  /** sectionsChanged：和预填相比，两本书里换了搭档的节数 */
  | { name: 'merge_started'; sectionsChanged: number; layout: Layout }
  /** seconds：从点合并到可以下载 */
  | { name: 'merge_done'; seconds: number; chars: CharsBucket; layout: Layout }
  /** LANGUAGE：合并时 core 又查出了语言问题；UNEXPECTED：Worker 抛错 */
  | { name: 'merge_failed'; code: 'LANGUAGE' | 'UNEXPECTED' }
  | { name: 'merge_cancelled'; stage: CancelStage }
  | { name: 'download'; nth: NthBucket };

type EventData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    /** Umami 的脚本加载成功后才有 */
    umami?: { track: (name: string, data?: EventData) => void };
  }
}

/** BCP 47 的短代码（en、zh-Hans、und），其他字符串一律不发 */
const LANG_CODE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/;

/** 事件 → Umami 的（事件名, 字段）。lang 不像语言代码时换成 und，多一道保险 */
export function toPayload(event: AnalyticsEvent): [string, EventData] {
  const { name, ...data } = event;
  if ('lang' in data && !LANG_CODE.test(data.lang)) data.lang = 'und';
  return [name, data];
}

export function track(event: AnalyticsEvent): void {
  const [name, data] = toPayload(event);
  if (import.meta.env.DEV) {
    console.debug('[analytics]', name, data);
    return;
  }
  // 脚本被拦截器挡住、或者还没加载完，就不记这一条
  window.umami?.track(name, data);
}

/** 只在线上构建、填了编号时加载 Umami 的脚本 */
export function initAnalytics(): void {
  if (!import.meta.env.PROD || UMAMI_WEBSITE_ID === '') return;
  const script = document.createElement('script');
  script.defer = true;
  script.src = UMAMI_SCRIPT;
  script.dataset.websiteId = UMAMI_WEBSITE_ID;
  // 浏览器设置了"请勿跟踪"就不统计
  script.dataset.doNotTrack = 'true';
  document.head.append(script);
}

const MB = 1024 * 1024;

export function sizeBucket(bytes: number): SizeBucket {
  if (bytes < 5 * MB) return '<5MB';
  if (bytes < 20 * MB) return '5-20MB';
  return bytes <= 100 * MB ? '20-100MB' : '>100MB';
}

export function charsBucket(chars: number): CharsBucket {
  if (chars < 300_000) return '<300k';
  if (chars < 600_000) return '300-600k';
  if (chars < 1_200_000) return '600k-1.2M';
  return '1.2M+';
}

const DOWNLOADS_KEY = 'epubmerger.downloads';

/**
 * 这个浏览器里的下载数加一，返回档位。存不了（隐私模式等）就当第一本。
 * 传函数是因为有的浏览器连读 localStorage 这个变量都会抛错
 */
export function countDownload(getStorage: () => Pick<Storage, 'getItem' | 'setItem'>): NthBucket {
  let n = 1;
  try {
    const storage = getStorage();
    n = (Number(storage.getItem(DOWNLOADS_KEY)) || 0) + 1;
    storage.setItem(DOWNLOADS_KEY, String(n));
  } catch {
    // 读写不了，按第一本算
  }
  return n === 1 ? '1' : n <= 5 ? '2-5' : '6+';
}
