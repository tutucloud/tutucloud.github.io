import {
  isReady, loadOnline, loadLocal, embed,
} from './embedder.js';
import { splitIntoChunks } from './chunk.js';
import {
  putFile, getFiles, deleteFileData, putChunksWithVectors,
  getAllChunksAndVectors,
} from './db.js';
import { t, getLang, setLang, applyStatic, supportedLangs } from './i18n.js';

const $ = id => document.getElementById(id);
const fmtMB = b => (b / 1048576).toFixed(1) + 'MB';
const fmtKB = b => (b / 1024).toFixed(1) + 'KB';

// ---------- 语言 ----------

const langSelect = $('lang-select');
for (const { code, name } of supportedLangs()) {
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = name;
  langSelect.appendChild(opt);
}
langSelect.value = getLang();
applyStatic();
langSelect.addEventListener('change', () => {
  setLang(langSelect.value);
  applyStatic();
  document.querySelector('title').textContent = t('title');
  refreshFileTable();
  renderPrompt(); // 已有检索结果时按新语言重建提示词
});

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
const INPUT_MODEL_DIR = $('input-model-dir');

async function ensureLoaded() {
  if (isReady()) return true;
  setModelStatus(t('err_need_model'), 'error');
  return false;
}

BTN_ONLINE.addEventListener('click', async () => {
  BTN_ONLINE.disabled = true;
  INPUT_MODEL.disabled = true;
  INPUT_MODEL_DIR.disabled = true;
  setModelStatus(t('loading_model'));
  try {
    const name = await loadOnline(p => {
      if (p.status === 'progress' && p.total) {
        showProgress('model-progress-wrap', 'model-progress-label', 'model-progress',
          t('dl_progress', { file: p.file, a: (p.loaded / 1048576).toFixed(1), b: (p.total / 1048576).toFixed(1) }),
          p.loaded / p.total);
      } else if (p.status === 'done' && p.file) {
        showProgress('model-progress-wrap', 'model-progress-label', 'model-progress',
          t('dl_done', { file: p.file }), 1);
      }
    });
    $('model-progress-wrap').classList.add('hidden');
    setModelStatus(t('model_ready', { name }), 'ready');
  } catch (err) {
    setModelStatus(t('online_fail', { msg: err.message }), 'error');
  }
  BTN_ONLINE.disabled = false;
  INPUT_MODEL.disabled = false;
  INPUT_MODEL_DIR.disabled = false;
});

async function importLocalModel(files) {
  if (!files.length) {
    setModelStatus(t('pick_none'), 'error');
    return;
  }
  setModelStatus(t('pick_selected', { n: files.length, mb: fmtMB(files.reduce((s, f) => s + f.size, 0)) }));
  BTN_ONLINE.disabled = true;
  INPUT_MODEL.disabled = true;
  INPUT_MODEL_DIR.disabled = true;
  try {
    const name = await loadLocal(files);
    $('model-progress-wrap').classList.add('hidden');
    setModelStatus(t('model_ready', { name }), 'ready');
  } catch (err) {
    setModelStatus(t('import_fail', { msg: err.message }), 'error');
  }
  BTN_ONLINE.disabled = false;
  INPUT_MODEL.disabled = false;
  INPUT_MODEL_DIR.disabled = false;
  INPUT_MODEL.value = '';
  INPUT_MODEL_DIR.value = '';
}

function handleModelPick(input) {
  importLocalModel(Array.from(input.files));
}

INPUT_MODEL.addEventListener('change', () => handleModelPick(INPUT_MODEL));
INPUT_MODEL_DIR.addEventListener('change', () => handleModelPick(INPUT_MODEL_DIR));

// ---------- 文档区 ----------

let busy = false;

async function refreshFileTable() {
  const files = await getFiles();
  const tbody = $('files-tbody');
  tbody.innerHTML = '';
  for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${f.name}</td><td>${f.size < 1048576 ? fmtKB(f.size) : fmtMB(f.size)}</td><td>${f.chunkCount}</td><td>${t('state_ok')}</td>`;
    const tdBtn = document.createElement('td');
    const btn = document.createElement('button');
    btn.textContent = t('btn_del');
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
  $('docs-summary').textContent = files.length
    ? t('docs_summary', { n: files.length, m: files.reduce((s, f) => s + f.chunkCount, 0) })
    : t('docs_empty_hint');
}

// 支持的纯文本格式
const TEXT_EXTS = ['txt', 'md', 'markdown', 'mdx', 'csv', 'tsv', 'log', 'json', 'xml', 'html', 'htm', 'srt', 'vtt'];

// 极轻量的可读性处理：去掉 html 标签，其余原样
function normalizeText(name, text) {
  if (/\.html?$/i.test(name)) {
    text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
               .replace(/<[^>]+>/g, ' ')
               .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  return text;
}

$('input-docs').addEventListener('change', async () => {
  const picked = Array.from($('input-docs').files);
  $('input-docs').value = '';
  const files = picked.filter(f => TEXT_EXTS.includes(f.name.split('.').pop().toLowerCase()));
  const skipped = picked.length - files.length;
  if (!files.length) {
    showProgress('docs-progress-wrap', 'docs-progress-label', 'docs-progress',
      t('docs_none_supported', { exts: TEXT_EXTS.join('/') }), 0);
    return;
  }
  if (!(await ensureLoaded())) return;
  busy = true;
  if (skipped) {
    showProgress('docs-progress-wrap', 'docs-progress-label', 'docs-progress',
      t('skip_files', { n: skipped, m: files.length }), 0);
  }

  try {
    for (const file of files) {
      const fileId = crypto.randomUUID();
      const text = normalizeText(file.name, await file.text());
      const chunks = splitIntoChunks(text);
      if (!chunks.length) {
        putFile({ id: fileId, name: file.name, size: file.size, chunkCount: 0, addedAt: Date.now() });
        continue;
      }
      const vectors = await embed(
        chunks,
        'passage: ',
        (done, total) => showProgress('docs-progress-wrap', 'docs-progress-label', 'docs-progress',
          t('vec_progress', { file: file.name, done, total }), done / total)
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
    showProgress('docs-progress-wrap', 'docs-progress-label', 'docs-progress',
      t('proc_fail', { msg: err.message }), 0);
  }
  busy = false;
  refreshFileTable();
});

// ---------- 检索区 ----------

let lastResults = null; // { query, ranked } 供提示词生成

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // 向量已归一化，点积即余弦
}

function renderResultItem(li, r, i) {
  const meta = document.createElement('div');
  meta.className = 'result-meta';
  meta.textContent = t('src_fmt', { i: i + 1, file: r.chunk.fileName, idx: r.chunk.index + 1, score: r.score.toFixed(4) });
  const text = document.createElement('div');
  text.className = 'result-text clamped';
  text.textContent = r.chunk.text;
  text.addEventListener('click', () => text.classList.toggle('clamped'));
  li.appendChild(meta);
  li.appendChild(text);
}

$('btn-query').addEventListener('click', doQuery);
$('query-input').addEventListener('keydown', e => { if (e.key === 'Enter') doQuery(); });

async function doQuery() {
  const q = $('query-input').value.trim();
  if (!q) return;
  if (!(await ensureLoaded())) return;
  const TOP_K = 10;

  $('btn-query').disabled = true;
  $('query-status').textContent = t('querying');
  $('results').innerHTML = '';
  try {
    const [qv] = await embed([q], 'query: ');
    const all = await getAllChunksAndVectors();
    const valid = all.filter(x => x.vector && x.vector.length === qv.length);
    if (!valid.length) {
      $('query-status').textContent = t('lib_empty');
      lastResults = null;
      renderPrompt();
      return;
    }
    const ranked = valid
      .map(x => ({ chunk: x.chunk, score: cosine(qv, x.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);
    lastResults = { query: q, ranked };

    $('query-status').textContent = t('results_fmt', { n: valid.length, m: ranked.length });
    const ol = $('results');
    ranked.forEach((r, i) => {
      const li = document.createElement('li');
      renderResultItem(li, r, i);
      ol.appendChild(li);
    });
    renderPrompt();
  } catch (err) {
    $('query-status').textContent = t('query_fail', { msg: err.message });
  }
  $('btn-query').disabled = false;
}

// ---------- 提示词区 ----------

function buildPrompt(query, ranked) {
  const ctx = ranked
    .map((r, i) => t('src_fmt', { i: i + 1, file: r.chunk.fileName, idx: r.chunk.index + 1, score: r.score.toFixed(4) })
      + '\n' + r.chunk.text)
    .join('\n\n');
  const files = [...new Set(ranked.map(r => r.chunk.fileName))].join(', ');
  return t('prompt_tpl', { lang: t('lang_name'), ctx, q: query, n: ranked.length, files });
}

function renderPrompt() {
  const box = $('prompt-box');
  if (!lastResults || !lastResults.ranked.length) {
    box.classList.add('hidden');
    $('prompt-hint').classList.remove('hidden');
    return;
  }
  $('prompt-hint').classList.add('hidden');
  box.classList.remove('hidden');
  $('prompt-pre').textContent = buildPrompt(lastResults.query, lastResults.ranked);
  $('prompt-count').textContent = t('prompt_count', { n: lastResults.ranked.length });
}

$('btn-copy').addEventListener('click', async () => {
  const text = $('prompt-pre').textContent;
  const cs = $('copy-status');
  try {
    await navigator.clipboard.writeText(text);
    cs.textContent = t('copied');
  } catch {
    // clipboard API 不可用（如非 https/localhost）时回退到选中复制
    const range = document.createRange();
    range.selectNodeContents($('prompt-pre'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    cs.textContent = t('copy_fail');
  }
  setTimeout(() => { cs.textContent = ''; }, 3000);
});

// ---------- 初始化 ----------

document.querySelector('title').textContent = t('title');
refreshFileTable();
