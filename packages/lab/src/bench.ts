import { readFileSync } from 'node:fs';
import { extractBlocks, parseEpub, type Block } from '@epubmerger/core';
import { loadEmbedder, MODELS, type Embedder, type ModelKey } from './embed.ts';

/** 以后真正要算向量的块：去掉索引、脚注（结构上确定的非正文，见 trade-off 015）和图片 */
export function alignableBlocks(blocks: Block[]): Block[] {
  return blocks.filter(
    (b) =>
      b.region !== 'index' && b.region !== 'notes' && b.kind !== 'image' && b.text.trim() !== '',
  );
}

export function readBlocks(path: string): Block[] {
  const result = parseEpub(readFileSync(path));
  if (!result.ok) throw new Error(`${path}: ${result.error.code}`);
  return alignableBlocks(extractBlocks(result.book).blocks);
}

/** 先按长度排好再分批，算完按原顺序排回去：一批里的文字会被补齐到同样长度，长短混在一起很浪费 */
export async function embedSorted(embedder: Embedder, texts: string[]): Promise<Float32Array[]> {
  const order = texts.map((_, i) => i).sort((a, b) => texts[a]!.length - texts[b]!.length);
  const vectors = await embedder.embed(order.map((i) => texts[i]!));
  const out = new Array<Float32Array>(texts.length);
  order.forEach((i, k) => (out[i] = vectors[k]!));
  return out;
}

interface Run {
  label: string;
  blocks: number;
  seconds: number;
  peakMB: number;
}

/** 跑一次并计时，同时每 50 毫秒看一次进程内存，记下最高值 */
async function timed(label: string, texts: string[], run: () => Promise<unknown>): Promise<Run> {
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 50);
  const start = performance.now();
  await run();
  const seconds = (performance.now() - start) / 1000;
  clearInterval(timer);
  peak = Math.max(peak, process.memoryUsage().rss);
  return { label, blocks: texts.length, seconds, peakMB: peak / 2 ** 20 };
}

const SAMPLE = 500;
const BATCH_SIZES = [1, 16, 32];

export interface BookBench {
  book: string;
  model: ModelKey;
  blocks: number;
  chars: number;
  loadSeconds: number;
  runs: Run[];
  /** 用最快的方式算完整本书 */
  full: Run;
}

export async function benchBook(path: string, model: ModelKey): Promise<BookBench> {
  const texts = readBlocks(path).map((b) => b.text);
  const sample = texts.slice(0, SAMPLE);

  const loadStart = performance.now();
  const embedder = await loadEmbedder(model);
  const loadSeconds = (performance.now() - loadStart) / 1000;
  // 第一次运行要初始化，特别慢，不算成绩
  await embedder.embed(sample.slice(0, 8));

  const runs: Run[] = [];
  for (const size of BATCH_SIZES) {
    embedder.batchSize = size;
    runs.push(await timed(`batch ${size}`, sample, () => embedder.embed(sample)));
  }
  for (const size of [16, 32]) {
    embedder.batchSize = size;
    runs.push(await timed(`batch ${size} sorted`, sample, () => embedSorted(embedder, sample)));
  }

  const best = runs.reduce((a, b) => (b.seconds < a.seconds ? b : a));
  embedder.batchSize = Number(best.label.split(' ')[1]);
  const sorted = best.label.endsWith('sorted');
  const full = await timed(`full (${best.label})`, texts, () =>
    sorted ? embedSorted(embedder, texts) : embedder.embed(texts),
  );

  return {
    book: path,
    model,
    blocks: texts.length,
    chars: texts.reduce((n, t) => n + t.length, 0),
    loadSeconds,
    runs,
    full,
  };
}

export function formatBench(r: BookBench): string {
  const rate = (run: Run) => (run.blocks / run.seconds).toFixed(0);
  const lines = [
    `${r.book} · ${MODELS[r.model].id}`,
    `  ${r.blocks} blocks, ${r.chars} chars (avg ${(r.chars / r.blocks).toFixed(0)}), load ${r.loadSeconds.toFixed(1)} s`,
    ...[...r.runs, r.full].map(
      (run) =>
        `  ${run.label.padEnd(26)} ${run.blocks.toString().padStart(5)} blocks ` +
        `${run.seconds.toFixed(1).padStart(7)} s ${rate(run).padStart(5)} blocks/s ` +
        `${run.peakMB.toFixed(0).padStart(5)} MB`,
    ),
  ];
  return lines.join('\n');
}

/** 所有书、所有模型的汇总：一行一本书，全书耗时 */
export function benchSummary(results: BookBench[]): string {
  const header = `${'book'.padEnd(48)} ${'model'.padEnd(7)} ${'blocks'.padStart(6)} ${'chars'.padStart(8)} ${'full s'.padStart(7)} ${'blk/s'.padStart(6)} ${'MB'.padStart(5)}`;
  const rows = results.map(
    (r) =>
      `${r.book.replace(/^fixtures\/pairs\//, '').padEnd(48)} ${r.model.padEnd(7)} ` +
      `${r.blocks.toString().padStart(6)} ${r.chars.toString().padStart(8)} ` +
      `${r.full.seconds.toFixed(1).padStart(7)} ${(r.blocks / r.full.seconds).toFixed(0).padStart(6)} ` +
      `${r.full.peakMB.toFixed(0).padStart(5)}`,
  );
  return [header, ...rows].join('\n');
}
