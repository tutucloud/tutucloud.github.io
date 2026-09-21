// 嵌入模型加载与向量化，基于 transformers.js
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5';

const MODEL_ID = 'Xenova/multilingual-e5-small';
const LOCAL_CACHE = 'rag-local-models';
export const MAX_MODEL_FILE_BYTES = 200 * 1024 * 1024; // 单文件 200MB 上限

let extractor = null;
let currentSource = null; // 'online' | 'local'

// 本地导入模型的 Cache 适配器：按文件名匹配 Cache Storage 中的条目。
// 缺失文件返回 404 响应，让 transformers.js 报出具体缺哪个文件。
class LocalModelCache {
  async match(request) {
    const url = typeof request === 'string' ? request : request.url;
    const name = url.split('/').pop();
    const cache = await caches.open(LOCAL_CACHE);
    return (await cache.match('/local/' + name)) || new Response('not found', { status: 404 });
  }
  async put(request, response) {
    const url = typeof request === 'string' ? request : request.url;
    const name = url.split('/').pop();
    const cache = await caches.open(LOCAL_CACHE);
    await cache.put('/local/' + name, response);
  }
}

export function isReady() {
  return extractor !== null;
}

export function source() {
  return currentSource;
}

// 在线加载：优先同源 models/ 目录（离线可用），其次 huggingface.co，
// 再回退 hf-mirror.com 镜像。progress_callback 上报下载进度。
export async function loadOnline(onProgress) {
  env.allowLocalModels = true;
  env.localModelPath = '/models/';
  env.useBrowserCache = true;
  env.customCache = undefined;
  const attempts = [
    ['local', null],
    ['online', 'https://huggingface.co'],
    ['online', 'https://hf-mirror.com'],
  ];
  let lastErr;
  for (const [kind, host] of attempts) {
    env.remoteHost = host || 'https://huggingface.co';
    try {
      extractor = await pipeline('feature-extraction', MODEL_ID, {
        progress_callback: onProgress,
        dtype: 'q8',
      });
      currentSource = kind;
      return kind === 'local' ? MODEL_ID + '（本站 models/ 目录）' : MODEL_ID;
    } catch (err) {
      lastErr = err;
      if (!/fetch|network|Failed/i.test(String(err && err.message))) throw err;
    }
  }
  throw lastErr;
}

// 导入本地模型文件（可来自文件夹递归选择），存入 Cache Storage 后从本地加载。
// 只接受白名单内的文件（其余自动跳过），依次尝试 q8 量化与 fp32 权重。
const NEEDED_FILES = new Set([
  'config.json', 'tokenizer.json', 'tokenizer_config.json',
  'special_tokens_map.json', 'vocab.txt', 'merges.txt',
  'added_tokens.json',
  'model_quantized.onnx', 'model.onnx', 'quantized.onnx',
]);

export async function loadLocal(fileList, onProgress) {
  const cache = await caches.open(LOCAL_CACHE);
  const names = [];
  let totalBytes = 0;
  let skipped = 0;
  for (const f of fileList) {
    if (!NEEDED_FILES.has(f.name)) { skipped++; continue; }
    if (f.size > MAX_MODEL_FILE_BYTES) {
      throw new Error(`文件 ${f.name} 超过 200MB 大小限制（实际 ${(f.size / 1048576).toFixed(1)}MB）`);
    }
    const buf = await f.arrayBuffer();
    totalBytes += buf.byteLength;
    await cache.put('/local/' + f.name, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } }));
    names.push(f.name);
  }
  if (onProgress) onProgress({ status: 'stored', names, skipped });
  for (const required of ['config.json', 'tokenizer.json']) {
    if (!names.includes(required)) {
      throw new Error(`缺少必需文件 ${required}，请选择模型目录（允许包含 onnx/ 子目录）`);
    }
  }
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = '/';
  const customCache = new LocalModelCache();
  env.customCache = customCache;
  let lastErr;
  for (const dtype of ['q8', 'fp32']) {
    try {
      extractor = await pipeline('feature-extraction', 'local', {
        progress_callback: onProgress,
        dtype,
      });
      currentSource = 'local';
      return `本地导入模型（${names.length} 个文件，共 ${(totalBytes / 1048576).toFixed(1)}MB）`;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// 批量向量化：texts 为字符串数组，prefix 为 e5 约定的 'query: ' 或 'passage: '
// 返回 Float32Array[]（已 L2 归一化）
export async function embed(texts, prefix, onBatch) {
  if (!extractor) throw new Error('嵌入模型尚未加载');
  const BATCH = 8;
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map(t => prefix + t);
    const res = await extractor(batch, { pooling: 'mean', normalize: true });
    for (let j = 0; j < batch.length; j++) {
      out.push(Float32Array.from(res[j].data));
    }
    if (onBatch) onBatch(Math.min(i + BATCH, texts.length), texts.length);
  }
  return out;
}
