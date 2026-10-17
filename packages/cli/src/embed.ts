import { env, pipeline } from '@huggingface/transformers';
import type { Embedder } from '@epubmerger/core';

/** 模型下载到这里，和 lab 共用一份，不进 git */
const MODEL_DIR = 'fixtures/.cache/models';

const E5 = { id: 'Xenova/multilingual-e5-small', dim: 384, batchSize: 16 };

/**
 * 加载 e5（第一次会从 Hugging Face 下载，8 位量化版约 100 MB），实现 core 的 Embedder。
 * 设置和 lab 的 loadEmbedder('e5') 一样，算出的向量也一样
 */
export async function loadE5(): Promise<Embedder> {
  env.cacheDir = MODEL_DIR;
  const extractor = await pipeline('feature-extraction', E5.id, { dtype: 'q8' });
  return {
    name: 'e5',
    dim: E5.dim,
    async embed(texts) {
      const out: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += E5.batchSize) {
        // e5 训练时每段文字前都有 "passage: "，用的时候也要加
        const batch = texts.slice(i, i + E5.batchSize).map((t) => `passage: ${t}`);
        const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
        // 结果是 [batch.length, dim] 的矩阵，按行切开
        const data = tensor.data as Float32Array;
        for (let row = 0; row < batch.length; row++) {
          out.push(data.slice(row * E5.dim, (row + 1) * E5.dim));
        }
      }
      return out;
    },
  };
}
