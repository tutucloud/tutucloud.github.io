// 训练 Worker：Transformer 构建（TF.js ops）、字符级数据、训练循环、生成、注意力提取。
// 依据 spec/01-specs/0001-web-mini-gpt.md 实现。
import * as tf from 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/+esm';

// 说明：曾尝试 WebGPU 后端，训练步会卡死（算子兼容问题），故使用 WebGL/CPU 兜底路径。
await tf.ready();
post({ ev: 'boot', backend: tf.getBackend() });

let cfg = null;       // { layers, heads, dModel, context, dropout, lr, B(batch), ... }
let itos = [], stoi = new Map();
let data = null;      // Int32Array 全量 token id
let trainLen = 0;     // 前 90% 为训练集
let vars = [];        // 全部可训练 tf.variable
let W = null;         // 权重引用
let optimizer = null;
let step = 0;
let running = false, paused = false, stopFlag = false;
let finalLnG = null, finalLnB = null;
const causalCache = new Map();

const INIT_STD = 0.02;

function post(msg) { self.postMessage(msg); }

function makeVar(shape, std = INIT_STD) {
  const v = tf.variable(tf.mul(tf.randomNormal(shape), std));
  vars.push(v);
  return v;
}

// tanh 近似 GELU（tfjs 未导出 gelu 算子，用可导基础算子组合）
function gelu(x) {
  const c = Math.sqrt(2 / Math.PI);
  const inner = x.add(x.pow(3).mul(0.044715)).mul(c);
  return x.mul(0.5).mul(inner.tanh().add(1));
}

function layerNorm(x, g, b) {
  const { mean, variance } = tf.moments(x, -1, true);
  return x.sub(mean).div(variance.add(1e-5).sqrt()).mul(g).add(b);
}

// [1,1,T,T]，上三角（含对角线以外的未来位置）为 -1e9
function causalMask(T) {
  if (!causalCache.has(T)) {
    const lt = tf.tidy(() => tf.linalg.bandPart(tf.ones([T, T]), -1, 0));
    const m = tf.keep(tf.reshape(tf.sub(lt, 1).mul(1e9), [1, 1, T, T]));
    lt.dispose();
    causalCache.set(T, m);
  }
  return causalCache.get(T);
}

function buildModel() {
  vars = [];
  causalCache.clear();
  const D = cfg.dModel, T = cfg.context, V = itos.length, F = 4 * D;
  W = {
    tokEmb: makeVar([V, D]),
    posEmb: makeVar([T, D]),
    head: makeVar([D, V], 0.02 / (2 * cfg.layers)),
    layers: [],
  };
  finalLnG = makeVar([D], 1);
  finalLnB = makeVar([D], 0);
  for (let i = 0; i < cfg.layers; i++) {
    W.layers.push({
      ln1g: makeVar([D], 1), ln1b: makeVar([D], 0),
      wq: makeVar([D, D]), wk: makeVar([D, D]), wv: makeVar([D, D]), wo: makeVar([D, D]),
      ln2g: makeVar([D], 1), ln2b: makeVar([D], 0),
      w1: makeVar([D, F]), w2: makeVar([F, D]),
    });
  }
  optimizer = tf.train.adam(cfg.lr);
}

function paramCount() {
  return vars.reduce((s, v) => s + v.shape.reduce((a, n) => a * n, 1), 0);
}

// 前向：x int32 [B,T]。training 控制 dropout；attnOut 非空时收集各层注意力（调用方负责 dispose）。
// 默认在 tidy 外调用（训练时需要参与求导），纯推理请包在 tf.tidy 中。
function forward(x, training, attnOut) {
  const B = x.shape[0], T = x.shape[1], D = cfg.dModel, H = cfg.heads, dh = D / H;
  let h = tf.gather(W.tokEmb, x.flatten()).reshape([B, T, D]).add(tf.slice(W.posEmb, [0, 0], [T, D]));
  if (training && cfg.dropout > 0) h = tf.dropout(h, cfg.dropout);
  for (const L of W.layers) {
    // 所有对权重矩阵的投影都先展平成 2D：TF.js 对 3D×2D 批量 matMul 求梯度会形状报错
    const a = layerNorm(h, L.ln1g, L.ln1b).reshape([B * T, D]);
    const q = a.matMul(L.wq).reshape([B, T, H, dh]).transpose([0, 2, 1, 3]);
    const k = a.matMul(L.wk).reshape([B, T, H, dh]).transpose([0, 2, 1, 3]);
    const v = a.matMul(L.wv).reshape([B, T, H, dh]).transpose([0, 2, 1, 3]);
    const att = tf.softmax(q.matMul(k.transpose([0, 1, 3, 2])).div(Math.sqrt(dh)).add(causalMask(T)), -1);
    if (attnOut) attnOut.push(att.clone());
    let o = att.matMul(v).transpose([0, 2, 1, 3]).reshape([B * T, D]).matMul(L.wo).reshape([B, T, D]);
    if (training && cfg.dropout > 0) o = tf.dropout(o, cfg.dropout);
    h = h.add(o);
    const h2 = layerNorm(h, L.ln2g, L.ln2b).reshape([B * T, D]);
    let f = gelu(h2.matMul(L.w1)).matMul(L.w2).reshape([B, T, D]);
    if (training && cfg.dropout > 0) f = tf.dropout(f, cfg.dropout);
    h = h.add(f);
  }
  return layerNorm(h, finalLnG, finalLnB).reshape([B * T, D]).matMul(W.head).reshape([B, T, itos.length]); // [B,T,V]
}

function sampleBatch(split) {
  const { B, T } = cfg;
  const lo = split === 'train' ? 0 : trainLen;
  const hi = split === 'train' ? trainLen : data.length;
  const xs = new Int32Array(B * T), ys = new Int32Array(B * T);
  for (let b = 0; b < B; b++) {
    const s = lo + Math.floor(Math.random() * Math.max(1, hi - lo - T - 1));
    for (let t = 0; t < T; t++) { xs[b * T + t] = data[s + t]; ys[b * T + t] = data[s + t + 1]; }
  }
  return {
    x: tf.tensor2d(xs, [B, T], 'int32'),
    y: tf.tensor2d(ys, [B, T], 'int32'),
  };
}

function encode(text) {
  const ids = [];
  for (const ch of text) { const id = stoi.get(ch); if (id !== undefined) ids.push(id); }
  return Int32Array.from(ids);
}

function evalVal() {
  let total = 0;
  const n = 4;
  for (let i = 0; i < n; i++) {
    const { x, y } = sampleBatch('val');
    const l = tf.tidy(() => {
      const logits = forward(x, false);
      return tf.losses.softmaxCrossEntropy(tf.oneHot(y, itos.length), logits).dataSync()[0];
    });
    x.dispose(); y.dispose();
    total += l;
  }
  return total / n;
}

async function trainLoop() {
  running = true; stopFlag = false; paused = false;
  post({ ev: 'running' });
  const t0 = performance.now();
  let seen = 0;
  try {
    while (!stopFlag) {
      if (paused) { await new Promise(r => setTimeout(r, 100)); continue; }
      const { x, y } = sampleBatch('train');
      const cost = optimizer.minimize(
        () => tf.losses.softmaxCrossEntropy(tf.oneHot(y, itos.length), forward(x, true)),
        true, vars,
      );
      const loss = cost.dataSync()[0];
      cost.dispose(); x.dispose(); y.dispose();
      step++; seen += cfg.B * cfg.T;
      let val = null;
      if (step % 20 === 0) val = await evalVal();
      post({ ev: 'loss', step, loss, val, sps: step / ((performance.now() - t0) / 1000), tokens: seen });
      await tf.nextFrame();
    }
  } catch (err) {
    post({ ev: 'error', message: '训练出错：' + String((err && err.message) || err) });
  }
  running = false;
  post({ ev: 'stopped', step });
}

function softmaxTop(logits, temperature, topK) {
  const arr = Array.from(logits).map((v, i) => [v / temperature, i]);
  arr.sort((a, b) => b[0] - a[0]);
  const top = arr.slice(0, Math.max(1, Math.min(topK, arr.length)));
  const max = Math.max(...top.map(p => p[0]));
  const exps = top.map(p => Math.exp(p[0] - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return top.map((p, i) => ({ idx: p[1], p: exps[i] / sum }));
}

async function generate(prompt, maxTokens, temperature, topK) {
  let ids = Array.from(encode(prompt));
  if (ids.length === 0) ids = [Math.floor(Math.random() * itos.length)];
  for (let i = 0; i < maxTokens; i++) {
    const ctx = ids.slice(-cfg.context);
    const x = tf.tensor2d(ctx, [1, ctx.length], 'int32');
    const lg = tf.tidy(() => forward(x, false).reshape([ctx.length, -1])
      .slice([ctx.length - 1, 0], [1, -1]).reshape([-1]).arraySync());
    x.dispose();
    const cand = softmaxTop(lg, temperature, topK);
    const pick = (() => {
      let r = Math.random();
      for (const c of cand) { r -= c.p; if (r <= 0) return c; }
      return cand[cand.length - 1];
    })();
    ids.push(pick.idx);
    post({
      ev: 'gen',
      token: itos[pick.idx],
      top: cand.map(c => ({ token: itos[c.idx], p: c.p })),
    });
    if (running) await new Promise(r => setTimeout(r, 0));
  }
  post({ ev: 'genDone', text: ids.map(i => itos[i]).join('') });
}

async function attention(text, layer, head) {
  const ids = Array.from(encode(text)).slice(0, cfg.context);
  if (ids.length === 0) { post({ ev: 'error', message: '输入文本没有可识别字符（需用训练语料中出现的字符）' }); return; }
  const T = ids.length, D = cfg.dModel, H = cfg.heads, dh = D / H;
  const attnOut = [];
  const x = tf.tensor2d(ids, [1, T], 'int32');
  tf.tidy(() => {
    let h = tf.gather(W.tokEmb, x.flatten()).reshape([1, T, D]).add(tf.slice(W.posEmb, [0, 0], [T, D]));
    for (const L of W.layers) {
      const a = layerNorm(h, L.ln1g, L.ln1b);
      const q = a.matMul(L.wq).reshape([1, T, H, dh]).transpose([0, 2, 1, 3]);
      const k = a.matMul(L.wk).reshape([1, T, H, dh]).transpose([0, 2, 1, 3]);
      const v = a.matMul(L.wv).reshape([1, T, H, dh]).transpose([0, 2, 1, 3]);
      const att = tf.softmax(q.matMul(k.transpose([0, 1, 3, 2])).div(Math.sqrt(dh)).add(causalMask(T)), -1);
      attnOut.push(tf.keep(att.clone()));
      h = h.add(att.matMul(v).transpose([0, 2, 1, 3]).reshape([1, T, D]).matMul(L.wo));
      h = h.add(gelu(layerNorm(h, L.ln2g, L.ln2b).matMul(L.w1)).matMul(L.w2));
    }
    return 0;
  });
  x.dispose();
  const li = Math.min(layer, attnOut.length - 1);
  const mat = await attnOut[li].array(); // [1,H,T,T]
  attnOut.forEach(t => t.dispose());
  post({ ev: 'attn', tokens: ids.map(i => itos[i]), matrix: mat[0][Math.min(head, H - 1)], layer: li, head: Math.min(head, H - 1) });
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    switch (m.cmd) {
      case 'setup': {
        itos = Array.from(new Set(Array.from(m.text))).filter(c => c !== '\r');
        stoi = new Map(itos.map((c, i) => [c, i]));
        if (itos.length < 2) { post({ ev: 'error', message: '训练文本太短，至少需要 2 个不同字符' }); return; }
        data = encode(m.text.replace(/\r/g, ''));
        cfg = { ...m.config, B: m.config.batch, T: m.config.context };
        trainLen = Math.floor(data.length * 0.9);
        if (data.length < cfg.context + 2) { post({ ev: 'error', message: `文本太短：至少需要 ${cfg.context + 2} 个字符（当前 ${data.length}）` }); return; }
        if (trainLen < cfg.context + 1 || data.length - trainLen < cfg.context + 1) { post({ ev: 'error', message: '训练/验证集太短，请加长文本' }); return; }
        step = 0;
        buildModel();
        post({ ev: 'ready', vocabSize: itos.length, paramCount: paramCount(), chars: data.length, trainChars: trainLen, backend: tf.getBackend() });
        break;
      }
      case 'train':
        if (!W) { post({ ev: 'error', message: '请先创建模型' }); return; }
        if (!running) trainLoop();
        break;
      case 'pause': paused = m.on; break;
      case 'stop': stopFlag = true; break;
      case 'generate':
        if (!W) { post({ ev: 'error', message: '请先创建模型' }); return; }
        await generate(m.prompt, m.maxTokens, m.temperature, m.topK);
        break;
      case 'attention':
        if (!W) { post({ ev: 'error', message: '请先创建模型' }); return; }
        await attention(m.text, m.layer, m.head);
        break;
    }
  } catch (err) {
    post({ ev: 'error', message: String((err && err.message) || err) });
  }
};
