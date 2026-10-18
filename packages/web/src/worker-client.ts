// 主线程这边：建 Worker、调用它、取消。
// 取消就是直接杀掉 Worker 再建一个新的：Worker 在同步计算的时候收不到消息，没法让它自己停

import * as Comlink from 'comlink';
import type { WorkerApi } from './worker.ts';

export const CANCELLED = 'cancelled';

let worker: Worker;
let remote: Comlink.Remote<WorkerApi>;
/** 还在等结果的调用；取消时让它们都返回 CANCELLED */
const pending = new Set<() => void>();

function start() {
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  remote = Comlink.wrap<WorkerApi>(worker);
}
start();

/** 在 Worker 里调用一个函数；中途被取消就返回 CANCELLED */
export function call<T>(fn: (api: Comlink.Remote<WorkerApi>) => T) {
  // comlink 把返回联合类型的函数标成 Promise<A> | Promise<B>，Awaited 把它变回 A | B
  return new Promise<Awaited<T> | typeof CANCELLED>((resolve, reject) => {
    const onCancel = () => resolve(CANCELLED);
    pending.add(onCancel);
    Promise.resolve(fn(remote)).then(
      (value) => {
        pending.delete(onCancel);
        resolve(value);
      },
      (error: unknown) => {
        pending.delete(onCancel);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** 停掉 Worker 里正在跑的一切 */
export function cancel() {
  worker.terminate();
  for (const onCancel of pending) onCancel();
  pending.clear();
  start();
}

/** 函数不能直接跨线程传，要用 proxy 包一层（进度回调用） */
export const callback = Comlink.proxy;
