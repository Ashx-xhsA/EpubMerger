/**
 * 把一批文字变成向量。trade-off 011 预留的 embed(texts) 接口：
 * 本地模型、带缓存的版本、将来的远程 API 都实现它，调用方不用管是哪一种。
 * core 只用这个接口，不加载模型：模型由调用方（命令行、网页的 Worker）加载好交进来
 */
export interface Embedder {
  /** 缓存文件名用，同一个模型的不同设置要用不同的名字 */
  readonly name: string;
  readonly dim: number;
  /** 返回的向量和 texts 一一对应，长度都是 1（已归一化），所以点积就是余弦相似度 */
  embed(texts: string[]): Promise<Float32Array[]>;
}
