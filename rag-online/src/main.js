import {
  isReady, source, loadOnline, loadLocal, embed,
  MAX_MODEL_FILE_BYTES,
} from './embedder.js';
import { splitIntoChunks } from './chunk.js';
import {
  putFile, getFiles, deleteFileData, putChunksWithVectors,
  getAllChunksAndVectors,
} from './db.js';

const $ = id => document.getElementById(id);

// ---------- 模型区 ----------

function setModelStatus(text, cls = '') {
  $('model-status').textContent = text;
  $('model-status').className = 'status ' + cls;
}

function showProgress(wrapId, labelId, barId, label, pct) {
  $(wrapId).classList.remove('hidden');
  $(labelId).textContent = label;
  $(barId).value = Math.round(pct * 100);
}

const BTN_ONLINE = $('btn-online');
const INPUT_MODEL = $('input-model');

async function ensureLoaded() {
  if (isReady()) return true;
  setModelStatus('请先加载嵌入模型（在线下载或本地导入）', 'error');
  return false;
}

BTN_ONLINE.addEventListener('click', async () => {
  BTN_ONLINE.disabled = true;
  INPUT_MODEL.disabled = true;
  setModelStatus('正在加载模型…');
  try {
    const name = await loadOnline(p => {
      if (p.status === 'progress' && p.total) {
        showProgress('model-progress-wrap', 'model-progress-label', 'model-progress',
          `下载 ${p.file}：${(p.loaded / 1048576).toFixed(1)}MB / ${(p.total / 1048576).toFixed(1)}MB`,
          p.loaded / p.total);
      } else if (p.status === 'done' && p.file) {
        showProgress('model-progress-wrap', 'model-progress-label', 'model-progress',
          `完成 ${p.file}`, 1);
      }
    });
    $('model-progress-wrap').classList.add('hidden');
    setModelStatus(`模型就绪（${name}，在线缓存）`, 'ready');
  } catch (err) {
    setModelStatus('模型加载失败：' + err.message, 'error');
  }
  BTN_ONLINE.disabled = false;
  INPUT_MODEL.disabled = false;
});

INPUT_MODEL.addEventListener('change', async () => {
  const files = Array.from(INPUT_MODEL.files);
  if (!files.length) return;
  BTN_ONLINE.disabled = true;
  INPUT_MODEL.disabled = true;
  setModelStatus('正在导入本地模型…');
  try {
    const total = files.reduce((s, f) => s + f.size, 0);
    let done = 0;
    const name = await loadLocal(files, undefined);
    $('model-progress-wrap').classList.add('hidden');
    setModelStatus(`模型就绪（本地导入，${files.length} 个文件，共 ${(total / 1048576).toFixed(1)}MB）`, 'ready');
  } catch (err) {
    setModelStatus('本地导入失败：' + err.message, 'error');
  }
  BTN_ONLINE.disabled = false;
  INPUT_MODEL.disabled = false;
  INPUT_MODEL.value = '';
});

// ---------- 文档区 ----------

let busy = false;

function fmtSize(bytes) {
  return bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + 'KB' : (bytes / 1048576).toFixed(1) + 'MB';
}

async function refreshFileTable() {
  const files = await getFiles();
  const tbody = $('files-tbody');
  tbody.innerHTML = '';
  for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${f.name}</td><td>${fmtSize(f.size)}</td><td>${f.chunkCount}</td><td>已入库</td>`;
    const tdBtn = document.createElement('td');
    const btn = document.createElement('button');
    btn.textContent = '删除';
    btn.addEventListener('click', async () => {
      if (busy) return;
      await deleteFileData(f.id);
      refreshFileTable();
    });
    tdBtn.appendChild(btn);
    tr.appendChild(tdBtn);
    tbody.appendChild(tr);
  }
  $('files-table').classList.toggle('hidden', files.length === 0);
  const totalChunks = files.reduce((s, f) => s + f.chunkCount, 0);
  $('docs-summary').textContent = files.length
    ? `共 ${files.length} 个文件，${totalChunks} 个切片`
    : '尚未导入文档';
}

$('input-docs').addEventListener('change', async () => {
  const files = Array.from($('input-docs').files).filter(f => f.name.toLowerCase().endsWith('.txt'));
  $('input-docs').value = '';
  if (!files.length) return;
  if (!(await ensureLoaded())) return;
  busy = true;

  try {
    for (const file of files) {
      const fileId = crypto.randomUUID();
      const text = await file.text();
      const chunks = splitIntoChunks(text);
      if (!chunks.length) {
        putFile({ id: fileId, name: file.name, size: file.size, chunkCount: 0, addedAt: Date.now() });
        continue;
      }
      const texts = chunks;
      const vectors = await embed(
        texts,
        'passage: ',
        (done, total) => showProgress('docs-progress-wrap', 'docs-progress-label', 'docs-progress',
          `向量化 ${file.name}：${done}/${total} 片`, done / total)
      );
      const now = Date.now();
      const chunkRecords = chunks.map((c, i) => ({
        id: crypto.randomUUID(),
        fileId,
        fileName: file.name,
        index: i,
        text: c,
        createdAt: now,
      }));
      await putChunksWithVectors(fileId, chunkRecords, vectors);
      await putFile({ id: fileId, name: file.name, size: file.size, chunkCount: chunks.length, addedAt: now });
    }
    $('docs-progress-wrap').classList.add('hidden');
  } catch (err) {
    showProgress('docs-progress-wrap', 'docs-progress-label', 'docs-progress', '处理失败：' + err.message, 0);
  }
  busy = false;
  refreshFileTable();
});

// ---------- 检索区 ----------

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // 向量已归一化，点积即余弦
}

$('btn-query').addEventListener('click', doQuery);
$('query-input').addEventListener('keydown', e => { if (e.key === 'Enter') doQuery(); });

async function doQuery() {
  const q = $('query-input').value.trim();
  if (!q) return;
  if (!(await ensureLoaded())) return;
  const TOP_K = 10;

  $('btn-query').disabled = true;
  $('query-status').textContent = '检索中…';
  $('results').innerHTML = '';
  try {
    const [qv] = await embed([q], 'query: ');
    const all = await getAllChunksAndVectors();
    const valid = all.filter(x => x.vector && x.vector.length === qv.length);
    if (!valid.length) {
      $('query-status').textContent = '文档库为空，请先导入 TXT 文件。';
      return;
    }
    const ranked = valid
      .map(x => ({ chunk: x.chunk, score: cosine(qv, x.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    $('query-status').textContent = `库内共 ${valid.length} 个切片，以下为最相关的 ${ranked.length} 条：`;
    const ol = $('results');
    ranked.forEach((r, i) => {
      const li = document.createElement('li');
      const meta = document.createElement('div');
      meta.className = 'result-meta';
      meta.innerHTML = `#<b>${i + 1}</b>　相似度 <span class="score">${r.score.toFixed(4)}</span>　来源：${r.chunk.fileName}（第 ${r.chunk.index + 1} 片）`;
      const text = document.createElement('div');
      text.className = 'result-text clamped';
      text.textContent = r.chunk.text;
      text.addEventListener('click', () => text.classList.toggle('clamped'));
      li.appendChild(meta);
      li.appendChild(text);
      ol.appendChild(li);
    });
  } catch (err) {
    $('query-status').textContent = '检索失败：' + err.message;
  }
  $('btn-query').disabled = false;
}

// ---------- 初始化 ----------

refreshFileTable();
