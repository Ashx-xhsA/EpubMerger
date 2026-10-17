/**
 * LaBSE 的最后一层：sentence-transformers 在 CLS 向量后面接了一层"全连接 + tanh"，
 * 而 Xenova/LaBSE 的 ONNX 只有模型主体。这层的权重单独存在官方仓库的 2_Dense/ 里，这里自己补上
 */

export interface Tensor {
  shape: number[];
  data: Float32Array;
}

/**
 * 读 safetensors 文件，只支持 float32。格式：
 * 前 8 字节是小端的 u64，表示后面 JSON 头的长度；JSON 头写着每个张量的类型、形状，
 * 以及它在数据区里的起止位置；数据区紧跟在 JSON 头后面
 */
export function parseSafetensors(bytes: Uint8Array): Map<string, Tensor> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = Number(view.getBigUint64(0, true));
  const dataStart = 8 + headerLength;
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, dataStart))) as Record<
    string,
    { dtype: string; shape: number[]; data_offsets: [number, number] }
  >;

  const tensors = new Map<string, Tensor>();
  for (const [name, info] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    if (info.dtype !== 'F32') throw new Error(`${name}: only F32 is supported, got ${info.dtype}`);
    const [from, to] = info.data_offsets;
    // 复制一份：Float32Array 要求起点是 4 的倍数，文件里的位置不一定是
    const data = new Float32Array((to - from) / 4);
    new Uint8Array(data.buffer).set(bytes.subarray(dataStart + from, dataStart + to));
    tensors.set(name, { shape: info.shape, data });
  }
  return tensors;
}

export interface DenseLayer {
  /** [输出维度, 输入维度]，按行存放（PyTorch nn.Linear 的存法） */
  weight: Tensor;
  bias: Float32Array;
}

/** 从 2_Dense/model.safetensors 里取出 linear.weight 和 linear.bias */
export function denseFromSafetensors(bytes: Uint8Array): DenseLayer {
  const tensors = parseSafetensors(bytes);
  const weight = tensors.get('linear.weight');
  const bias = tensors.get('linear.bias');
  if (!weight || !bias) throw new Error('missing linear.weight or linear.bias');
  return { weight, bias: bias.data };
}

/** y = tanh(W·x + b) */
export function applyDense(layer: DenseLayer, x: Float32Array): Float32Array {
  const [outDim, inDim] = layer.weight.shape as [number, number];
  if (x.length !== inDim) throw new Error(`expected input of length ${inDim}, got ${x.length}`);
  const w = layer.weight.data;
  const y = new Float32Array(outDim);
  for (let o = 0; o < outDim; o++) {
    let sum = layer.bias[o]!;
    const row = o * inDim;
    for (let i = 0; i < inDim; i++) sum += w[row + i]! * x[i]!;
    y[o] = Math.tanh(sum);
  }
  return y;
}
