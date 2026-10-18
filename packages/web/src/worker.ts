// Web Worker 的入口：把 pipeline 的两个函数交给主线程调用（comlink 把"发消息、等回复"包成 await）

import * as Comlink from 'comlink';
import { loadBook, mergeBooks, prepareChapters } from './pipeline.ts';

const api = {
  loadBook(...args: Parameters<typeof loadBook>) {
    const result = loadBook(...args);
    // 封面的字节同样直接交给主线程
    const cover = result.ok ? result.summary.cover : null;
    return cover === null ? result : Comlink.transfer(result, [cover.bytes.buffer]);
  },
  prepareChapters,
  async mergeBooks(...args: Parameters<typeof mergeBooks>) {
    const result = await mergeBooks(...args);
    // 生成的字节直接交给主线程（transfer），不复制
    return result.ok ? Comlink.transfer(result, [result.bytes.buffer]) : result;
  },
};

export type WorkerApi = typeof api;

Comlink.expose(api);
