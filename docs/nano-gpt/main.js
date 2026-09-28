// 主线程：UI 逻辑、loss 曲线绘制、注意力热力图绘制、与训练 Worker 通信。
const $ = id => document.getElementById(id);

const SAMPLE_TEXT = `国王对小王子说：“驯养就是建立感情联系。”
小王子问：“驯养需要做什么呢？”
国王说：“你需要有耐心。你先坐在离我稍远的地方，我用眼角看你，什么也不说。言语是误会的根源。但是，每天你都可以坐得离我更近一点……”`
  .repeat(12);

let worker = null, workerBooted = false;
const pendingMsgs = [];
let modelReady = false, training = false, paused = false, generating = false;
let layersCount = 2, headsCount = 2;
const trainHist = [], valHist = []; // {step, loss}

if (location.protocol === 'file:') $('fileWarn').style.display = 'block';

function msg(text, ok = false) {
  const el = $('msg');
  el.textContent = text;
  el.className = ok ? 'ok' : 'err';
  if (ok) setTimeout(() => { if (el.className === 'ok') el.className = ''; }, 4000);
}

// ---------- Worker ----------
// Chromium 对带顶层 await 的 module worker 会丢弃求值完成前收到的消息，
// 因此先积压消息，等 worker 发出 boot 后再放行。
function send(msgObj) {
  if (workerBooted) worker.postMessage(msgObj);
  else { pendingMsgs.push(msgObj); getWorker(); }
}

function getWorker() {
  if (!worker) {
    worker = new Worker('./worker.js?v=' + Date.now(), { type: 'module' });
    worker.onmessage = onWorkerMsg;
    worker.onerror = e => msg('Worker 错误：' + e.message);
  }
  return worker;
}

function readConfig() {
  const get = (id, lo, hi) => {
    const v = Number($(id).value);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`参数超范围：${id} 应在 [${lo}, ${hi}]`);
    return v;
  };
  return {
    layers: get('layers', 1, 4),
    heads: get('heads', 1, 8),
    dModel: get('dModel', 16, 256),
    context: get('context', 16, 256),
    dropout: get('dropout', 0, 0.9),
    lr: get('lr', 1e-5, 0.1),
    batch: get('batch', 4, 256),
  };
}

function buildModel() {
  const text = $('corpus').value;
  if (!text || text.trim().length === 0) { msg('请先在 ① 提供训练文本'); return; }
  let cfg;
  try { cfg = readConfig(); } catch (e) { msg(e.message); return; }
  if (cfg.dModel % cfg.heads !== 0) { msg(`d_model（${cfg.dModel}）必须能被注意力头数（${cfg.heads}）整除`); return; }
  msg('正在创建模型…', true);
  send({ cmd: 'setup', config: cfg, text });
}

// ---------- Worker 事件 ----------
function onWorkerMsg(e) {
  const m = e.data;
  if (m.ev === 'boot') {
    workerBooted = true;
    pendingMsgs.splice(0).forEach(x => worker.postMessage(x));
    return;
  }
  switch (m.ev) {
    case 'ready':
      modelReady = true;
      trainHist.length = 0; valHist.length = 0;
      layersCount = Number($('layers').value); headsCount = Number($('heads').value);
      fillLayerHeadSelects();
      $('modelInfo').textContent =
        `已创建：词表 ${m.vocabSize} · 参数量 ${m.paramCount.toLocaleString()} · 语料 ${m.chars} 字符（训练 ${m.trainChars} / 验证 ${m.chars - m.trainChars}）· 计算后端 ${m.backend}`;
      $('btnTrain').disabled = false;
      $('btnGen').disabled = false;
      $('btnAttn').disabled = false;
      drawLoss();
      msg('模型已创建', true);
      break;
    case 'running':
      training = true; paused = false;
      $('btnTrain').disabled = true; $('btnPause').disabled = false; $('btnStop').disabled = false;
      $('btnPause').textContent = '暂停';
      break;
    case 'loss':
      $('stStep').textContent = m.step;
      $('stLoss').textContent = m.loss.toFixed(4);
      $('stVal').textContent = m.val == null ? $('stVal').textContent : m.val.toFixed(4);
      $('stSps').textContent = m.sps.toFixed(1);
      $('stTok').textContent = m.tokens.toLocaleString();
      trainHist.push({ step: m.step, loss: m.loss });
      if (m.val != null) valHist.push({ step: m.step, loss: m.val });
      drawLoss();
      break;
    case 'stopped':
      training = false; paused = false;
      $('btnPause').textContent = '暂停';
      $('btnTrain').disabled = false; $('btnPause').disabled = true; $('btnStop').disabled = true;
      msg(`训练已停止（共 ${m.step} 步）`, true);
      break;
    case 'gen':
      if (!generating) { generating = true; $('genOut').textContent = ''; $('genOut').classList.remove('muted'); }
      $('genOut').textContent += m.token;
      renderProbs(m.top);
      break;
    case 'genDone':
      generating = false;
      $('btnGen').disabled = false;
      break;
    case 'attn':
      drawAttn(m.tokens, m.matrix);
      break;
    case 'error':
      window.__lastErr = m.message;
      msg(m.message);
      if (!modelReady) $('btnGen').disabled = true;
      $('btnGen').disabled = !modelReady || generating;
      break;
  }
}

function fillLayerHeadSelects() {
  $('attnLayer').innerHTML = Array.from({ length: layersCount }, (_, i) => `<option value="${i}">第 ${i + 1} 层</option>`).join('');
  $('attnHead').innerHTML = Array.from({ length: headsCount }, (_, i) => `<option value="${i}">头 ${i + 1}</option>`).join('');
}

// ---------- 事件绑定 ----------
$('btnSample').onclick = () => { $('corpus').value = SAMPLE_TEXT; onDataInput(); };
$('fileIn').onchange = async e => {
  const f = e.target.files[0];
  if (f) { $('corpus').value = await f.text(); onDataInput(); }
};
$('corpus').oninput = onDataInput;

function onDataInput() {
  const t = $('corpus').value;
  const vocab = new Set(Array.from(t));
  $('dataInfo').textContent = `字符数 ${t.length} · 词表（不同字符）${vocab.size}`;
  if (modelReady) {
    modelReady = false;
    $('btnTrain').disabled = true; $('btnGen').disabled = true; $('btnAttn').disabled = true;
    $('modelInfo').textContent = '文本已变更，请重新创建模型';
  }
}

$('btnBuild').onclick = buildModel;
$('btnTrain').onclick = () => {
  trainHist.length = 0; valHist.length = 0;
  send({ cmd: 'train' });
};
$('btnPause').onclick = () => {
  paused = !paused;
  send({ cmd: 'pause', on: paused });
  $('btnPause').textContent = paused ? '继续' : '暂停';
};
$('btnStop').onclick = () => {
  paused = false;
  send({ cmd: 'stop' });
};
$('btnGen').onclick = () => {
  if (!modelReady) { msg('请先创建模型'); return; }
  let t;
  try {
    t = {
      temperature: Number($('temp').value),
      topK: Number($('topk').value),
      maxTokens: Number($('maxTokens').value),
    };
    if (!(t.temperature > 0 && t.temperature <= 3)) throw new Error('temperature 应在 (0, 3]');
    if (!(Number.isInteger(t.topK) && t.topK >= 1 && t.topK <= 100)) throw new Error('top-k 应在 [1, 100]');
    if (!(Number.isInteger(t.maxTokens) && t.maxTokens >= 1 && t.maxTokens <= 2000)) throw new Error('生成长度应在 [1, 2000]');
  } catch (err) { msg(err.message.replace('id', '生成长度') || String(err)); return; }
  $('btnGen').disabled = true;
  send({ cmd: 'generate', prompt: $('prompt').value, ...t });
};
$('btnAttn').onclick = () => {
  if (!modelReady) { msg('请先创建模型'); return; }
  send({
    cmd: 'attention',
    text: $('attnText').value || $('prompt').value || $('corpus').value.slice(0, 32),
    layer: Number($('attnLayer').value) || 0,
    head: Number($('attnHead').value) || 0,
  });
};

function renderProbs(top) {
  $('probBars').innerHTML = top.map(c =>
    `<div class="bar"><span class="lab" title="${escapeHtml(c.token)}">${escapeHtml(repr(c.token))}</span>` +
    `<span class="fill" style="width:${(c.p * 30).toFixed(1)}em"></span>` +
    `<span>${(c.p * 100).toFixed(1)}%</span></div>`).join('');
}
const repr = ch => ({ '\n': '⏎', ' ': '␣' }[ch] ?? ch);
const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- loss 曲线（原生 canvas） ----------
function drawLoss() {
  const cv = $('lossCanvas'), ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, pad = { l: 46, r: 8, t: 10, b: 22 };
  ctx.clearRect(0, 0, W, H);
  const all = trainHist.concat(valHist);
  if (all.length === 0) {
    ctx.fillStyle = '#999'; ctx.font = '13px sans-serif';
    ctx.fillText('训练开始后此处绘制 loss 曲线', pad.l, H / 2);
    return;
  }
  const xMax = Math.max(all[all.length - 1].step, 1);
  const ys = all.map(p => p.loss);
  const yMin = Math.min(...ys) * 0.95, yMax = Math.max(...ys) * 1.05 || 1;
  const X = s => pad.l + (s / xMax) * (W - pad.l - pad.r);
  const Y = v => pad.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);
  // 网格与刻度
  ctx.strokeStyle = '#eee'; ctx.fillStyle = '#777'; ctx.font = '11px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const v = yMin + (yMax - yMin) * i / 4, y = Y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillText(v.toFixed(2), 6, y + 4);
  }
  ctx.fillText(String(xMax), W - pad.r - 20, H - 6);
  const line = (hist, color) => {
    if (hist.length === 0) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    hist.forEach((p, i) => i === 0 ? ctx.moveTo(X(p.step), Y(p.loss)) : ctx.lineTo(X(p.step), Y(p.loss)));
    ctx.stroke();
  };
  line(trainHist, '#2563eb');
  line(valHist, '#ea580c');
  ctx.fillStyle = '#2563eb'; ctx.fillText('— train', pad.l + 4, pad.t + 10);
  ctx.fillStyle = '#ea580c'; ctx.fillText('— val', pad.l + 60, pad.t + 10);
}

// ---------- 注意力热力图（原生 canvas） ----------
function drawAttn(tokens, matrix) {
  const cv = $('attnCanvas'), ctx = cv.getContext('2d');
  const T = tokens.length;
  const pad = 90;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const cell = Math.min((cv.width - pad - 10) / T, (cv.height - pad - 10) / T);
  const ox = pad, oy = pad;
  // 令牌标签（显示为字符，最多 60 个以保可读）
  const maxTok = 60;
  const stride = Math.ceil(T / maxTok);
  ctx.font = '12px sans-serif';
  for (let i = 0; i < T; i++) {
    if (i % stride !== 0 && i !== T - 1) continue;
    ctx.fillStyle = '#333';
    ctx.save();
    ctx.translate(ox + i * cell + cell / 2 + 4, oy - 6);
    ctx.fillText(label(tokens[i]), -4, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(ox - 6, oy + i * cell + cell / 2 + 4);
    ctx.fillText(label(tokens[i]), -ctx.measureText(label(tokens[i])).width, 4);
    ctx.restore();
  }
  for (let i = 0; i < T; i++) {
    for (let j = 0; j < T; j++) {
      const w = matrix[i][j];
      ctx.fillStyle = `rgba(37,99,235,${w})`;
      ctx.fillRect(ox + j * cell, oy + i * cell, Math.ceil(cell) - 0.5, Math.ceil(cell) - 0.5);
    }
  }
}
const label = ch => ({ '\n': '⏎', ' ': '␣', '\t': '⇥' }[ch] ?? ch);
