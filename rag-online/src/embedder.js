// 嵌入模型加载与向量化，基于 transformers.js
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5';

const MODEL_ID = 'Xenova/multilingual-e5-small';
const LOCAL_CACHE = 'rag-local-models';
export const MAX_MODEL_FILE_BYTES = 200 * 1024 * 1024; // 单文件 200MB 上限

let extractor = null;
let currentSource = null; // 'online' | 'local'

// 本地导入模型的 Cache 适配器：按文件名匹配 Cache Storage 中的条目
class LocalModelCache {
  async match(request) {
    const url = typeof request === 'string' ? request : request.url;
    const name = url.split('/').pop();
    const cache = await caches.open(LOCAL_CACHE);
    const hit = await cache.match('/local/' + name);
    if (hit) return hit;
    throw new Error('本地模型缺少文件：' + name);
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

// 导入本地模型文件，存入 Cache Storage 后从本地加载
export async function loadLocal(fileList, onProgress) {
  const cache = await caches.open(LOCAL_CACHE);
  const names = [];
  for (const f of fileList) {
    if (f.size > MAX_MODEL_FILE_BYTES) {
      throw new Error(`文件 ${f.name} 超过 200MB 大小限制（实际 ${(f.size / 1048576).toFixed(1)}MB）`);
    }
    const buf = await f.arrayBuffer();
    await cache.put('/local/' + f.name, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } }));
    names.push(f.name);
  }
  for (const required of ['config.json', 'tokenizer.json']) {
    if (!names.includes(required)) {
      throw new Error(`缺少必需文件 ${required}，请选择模型目录内的全部文件`);
    }
  }
  env.useBrowserCache = false;
  env.allowLocalModels = true;
  env.localModelPath = '/';
  env.customCache = new LocalModelCache();
  extractor = await pipeline('feature-extraction', 'local', {
    progress_callback: onProgress,
    dtype: 'q8',
  });
  currentSource = 'local';
  return '本地导入模型';
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
