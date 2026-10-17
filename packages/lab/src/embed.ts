import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import { normalize, type Embedder } from '@epubmerger/core';
import { applyDense, denseFromSafetensors } from './dense.ts';

interface ModelSpec {
  id: string;
  dim: number;
  /** 句子向量怎么从每个 token 的向量得来，按模型原来的训练方式 */
  pooling: 'mean' | 'cls';
  /** e5 训练时每段文字前都有 "passage: " 或 "query: "，用的时候也要加 */
  prefix: string;
  /** 池化之后还要接的"全连接 + tanh"层，权重文件的下载地址（见 dense.ts） */
  dense?: string;
}

export const MODELS = {
  e5: { id: 'Xenova/multilingual-e5-small', dim: 384, pooling: 'mean', prefix: 'passage: ' },
  minilm: {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    dim: 384,
    pooling: 'mean',
    prefix: '',
  },
  labse: {
    id: 'Xenova/LaBSE',
    dim: 768,
    pooling: 'cls',
    prefix: '',
    dense:
      'https://huggingface.co/sentence-transformers/LaBSE/resolve/main/2_Dense/model.safetensors',
  },
} as const satisfies Record<string, ModelSpec>;

export type ModelKey = keyof typeof MODELS;

export function isModelKey(key: string): key is ModelKey {
  return Object.hasOwn(MODELS, key);
}

/** 模型下载到这里，和测试集一样不进 git。默认位置在 node_modules 里，重装依赖就没了 */
export const MODEL_DIR = 'fixtures/.cache/models';

/** 本地模型。batchSize 是一次交给模型几段文字，可以随时改（bench 用同一个模型试不同的值） */
export interface LocalEmbedder extends Embedder {
  batchSize: number;
}

/** 加载一个模型（第一次会从 Hugging Face 下载）。用 8 位量化版：体积是原版的 1/4 */
export async function loadEmbedder(key: ModelKey, batchSize = 16): Promise<LocalEmbedder> {
  const spec: ModelSpec = MODELS[key];
  env.cacheDir = MODEL_DIR;
  const extractor = await pipeline('feature-extraction', spec.id, { dtype: 'q8' });
  const dense = spec.dense ? denseFromSafetensors(await download(spec.dense, spec.id)) : null;

  const embedder: LocalEmbedder = {
    name: key,
    dim: spec.dim,
    batchSize,
    async embed(texts) {
      const out: Float32Array[] = [];
      const size = embedder.batchSize;
      for (let i = 0; i < texts.length; i += size) {
        const batch = texts.slice(i, i + size).map((t) => spec.prefix + t);
        // 有 dense 层时，要先过这一层再归一化，所以这里先不归一化
        const tensor = await extractor(batch, { pooling: spec.pooling, normalize: !dense });
        // 结果是 [batch.length, dim] 的矩阵，按行切开
        const data = tensor.data as Float32Array;
        for (let row = 0; row < batch.length; row++) {
          const v = data.slice(row * spec.dim, (row + 1) * spec.dim);
          out.push(dense ? normalize(applyDense(dense, v)) : v);
        }
      }
      return out;
    },
  };
  return embedder;
}

/** 下载一个文件到模型目录，已经下载过就直接读 */
async function download(url: string, modelId: string): Promise<Uint8Array> {
  const path = join(MODEL_DIR, modelId, basename(dirname(url)), basename(url));
  if (!existsSync(path)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
  }
  return readFileSync(path);
}
