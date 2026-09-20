import { detectLang, setLang, getLang, t, applyStatic } from './i18n.js';
import { PROVIDERS } from './providers.js';
import { chatStream, bridgeAvailable, saveProfileToBridge, corsHelpNeeded } from './llm.js';
import { getData, getSettings, saveSettings, upsertScenario, deleteScenario, getSession, clearSession, persist, uid } from './storage.js';

const $ = (sel) => document.querySelector(sel);

let activeScenarioId = null;
let generating = false;

// ---------- language ----------
function initLang() {
  const saved = getSettings().lang || 'auto';
  $('#lang-select').value = saved;
  setLang(saved === 'auto' ? detectLang() : saved);
  applyStatic();
}
$('#lang-select').addEventListener('change', () => {
  const v = $('#lang-select').value;
  saveSettings({ lang: v });
  setLang(v === 'auto' ? detectLang() : v);
  applyStatic();
  renderAll();
});

// ---------- scenario list ----------
function renderScenarioList() {
  const ul = $('#scenario-list');
  ul.innerHTML = '';
  for (const sc of getData().scenarios) {
    const li = document.createElement('li');
    li.textContent = sc.name;
    if (sc.id === activeScenarioId) li.classList.add('active');
    li.onclick = () => selectScenario(sc.id);
    ul.appendChild(li);
  }
}

function selectScenario(id) {
  activeScenarioId = id;
  saveSettings({ activeScenarioId: id });
  renderAll();
}

// ---------- chat ----------
function npcColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.codePointAt(0)) % 360;
  return `hsl(${h}, 55%, 55%)`;
}

function addMessageEl({ kind, charName, content }, { typing = false } = {}) {
  const box = $('#messages');
  const div = document.createElement('div');
  div.className = `msg ${kind}` + (typing ? ' typing' : '');
  const name = document.createElement('div');
  name.className = 'char-name';
  if (kind === 'npc') {
    const dot = document.createElement('span');
    dot.className = 'npc-dot';
    dot.style.background = npcColor(charName);
    name.appendChild(dot);
    name.appendChild(document.createTextNode(charName));
  } else if (kind === 'user') {
    name.textContent = charName || t('you');
  } else {
    name.textContent = t('narrator');
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = content;
  div.append(name, bubble);
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return bubble;
}

function renderChat() {
  const sc = getData().scenarios.find(s => s.id === activeScenarioId);
  $('#empty-state').classList.toggle('hidden', !!sc);
  $('#chat-area').classList.toggle('hidden', !sc);
  if (!sc) return;
  $('#chat-title').textContent = sc.name;
  // World setting is DM-only knowledge: never shown directly to the player.
  $('#world-banner').classList.add('hidden');
  const box = $('#messages');
  box.innerHTML = '';
  const msgs = getSession(sc.id).messages;
  for (const m of msgs) addMessageEl(m);
  if (!msgs.length) {
    const st = getSettings();
    if (!generating && st.baseUrl && st.model) {
      // Empty session: the DM automatically opens the scene (no button needed).
      generate(true);
    } else if (!st.baseUrl || !st.model) {
      addMessageEl({ kind: 'narration', charName: '', content: t('needSetup') });
    }
  }
}

// ---------- prompt ----------
function buildSystemPrompt(sc) {
  const npcLines = sc.characters
    .filter(c => c.name)
    .map(c => `- ${c.name}: ${c.persona || ''}`)
    .join('\n');
  return [
    'You are the DM (Dungeon Master / game master) of a text role-playing game. You are the storyteller: YOU drive the plot forward. The player influences the story, but does not carry it.',
    'World / background:',
    (sc.worldSetting || '(none)'),
    'The player plays: ' + sc.userCharName + (sc.userPersona ? ' (' + sc.userPersona + ')' : ''),
    'Characters you voice:',
    npcLines,
    'How to run a turn:',
    '- Treat the player input (or their silence) as one event in the scene. Then YOU weave what happens next: consequences, character actions, new events, twists.',
    '- The player' + String.fromCharCode(39) + 's input is ALREADY displayed to them verbatim. Never repeat, quote, re-render or describe what the player just said or did — start AFTER that point and continue the story. Tagged lines ([PLAYER_LINE]/[PLAYER_ACTION]) are context only; never output them.',
    '- A turn is a SCENE, not a single reply. Play out several beats: characters react, move around, talk to EACH OTHER (not only to the player), pursue their own goals, and things happen in the world.',
    '- Characters are alive: each has motives, moods and an agenda of their own. They may interrupt each other, disagree, joke, hide things, or act without waiting for the player.',
    '- Reveal the world through concrete details and small events; escalate or introduce something new when the scene needs momentum.',
    '- End the turn at a natural, vivid moment where the floor passes to the player: a question, a choice, a danger, or a silence that invites their reaction. Never ask more than one thing at once.',
    'Delivery rules:',
    '- Reply in the same language the player uses.',
    '- Never speak or act for the player' + String.fromCharCode(39) + 's character.',
    '- Deliver everything ONLY through tool calls, one call per line of output:',
    '  - speak({ character, text }): a character says/does something. Use the exact character name.',
    '  - narrate({ text }): scene description or events not tied to one character.',
    '  - pause({ seconds }): a dramatic pause before the next line (0.5 to 3 seconds). Use it to control rhythm, e.g. between two characters, or before a reveal.',
    '- Keep each speak() short (one or two sentences) so lines flow like real dialogue; use many calls to build a full scene.',
    (sc.dmInstructions ? 'Extra instructions from the player for you as DM (highest priority): ' + sc.dmInstructions : ''),
  ].filter(Boolean).join('\n\n');


}

const RP_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'speak',
      description: 'A character (voiced by you) says something or performs a visible action.',
      parameters: {
        type: 'object',
        properties: {
          character: { type: 'string', description: 'Exact name of the character' },
          text: { type: 'string', description: 'What the character says (may include brief actions)' },
        },
        required: ['character', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'narrate',
      description: 'Scene description, atmosphere or events not tied to a single character.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The narration text' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pause',
      description: 'A dramatic pause before the next line, to control pacing.',
      parameters: {
        type: 'object',
        properties: {
          seconds: { type: 'number', description: 'Pause length in seconds (0.5 to 3)' },
        },
        required: ['seconds'],
      },
    },
  },
];

// Extract the current value of a string field from a possibly-incomplete JSON
// arguments string, so text can be streamed into the UI as it is generated.
function extractPartialString(argsStr, field) {
  const PDBG = (() => { try { return localStorage.getItem('storiesDebug') === '1'; } catch { return false; } })();
  let value;
  try {
    const obj = JSON.parse(argsStr);
    if (typeof obj[field] === 'string') return obj[field];
    value = '';
  } catch (e) {
    // still-incomplete JSON: fall through to the regex path
    if (PDBG) console.debug('%c[stories]%c parse partial', 'color:#090; font-weight:bold', 'color:inherit', { field, argsLen: argsStr.length });
    value = undefined;
  }
  const re = new RegExp('"' + field + '"' + '\\s*:\\s*"' + '((?:[^"\\\\]|\\\\.)*)');
  const m = argsStr.match(re);
  if (!m) {
    if (PDBG) console.debug('%c[stories]%c regex NO match', 'color:#c00; font-weight:bold', 'color:inherit', { field, argsTail: argsStr.slice(-60) });
    return '';
  }
  if (PDBG) console.debug('%c[stories]%c regex match', 'color:#090; font-weight:bold', 'color:inherit', { field, rawLen: m[1].length });
  try { return JSON.parse('"' + m[1] + '"'); } catch (e) {
    if (PDBG) console.debug('%c[stories]%c unescape fail', 'color:#c00; font-weight:bold', 'color:inherit', { err: String(e) });
    return m[1];
  }
}
function safeParseArgs(argsStr) {
  try { return JSON.parse(argsStr); } catch { return null; }
}

const NARRATOR_WORDS = new Set(['narrator', '旁白', 'ナレーション', '旁白', '场景', 'scene', 'narration']);
function isNarrator(name) {
  return NARRATOR_WORDS.has(name.trim().toLowerCase()) || NARRATOR_WORDS.has(name.trim());
}

// Parse 【Name】content lines into message objects.
function parseAiReply(text, sc) {
  const out = [];
  const lines = text.split('\n');
  const re = /^【\s*([^】]+?)\s*】\s*([\s\S]*)$/;
  let current = null; // { charName, buf }
  const flush = () => {
    if (current && current.buf.trim()) {
      let kind, saved;
      if (current.charName === sc.userCharName) { kind = 'user'; saved = sc.userCharName; }
      else if (isNarrator(current.charName)) { kind = 'narration'; saved = ''; }
      else { kind = 'npc'; saved = current.charName; }
      out.push({ kind, charName: saved, content: current.buf.trim(), ts: Date.now() });
    }
    current = null;
  };
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      flush();
      current = { charName: m[1].trim(), buf: m[2] };
    } else if (current) {
      current.buf += '\n' + line;
    } else if (line.trim()) {
      // unparsed text → narration
      out.push({ kind: 'narration', charName: '', content: line.trim(), ts: Date.now() });
    }
  }
  flush();
  return out;
}

// Structure the player's input into explicit tagged lines so the DM can echo
// each line correctly: * prefixed lines are actions, the rest are speech.
function structureInput(text) {
  const NL = String.fromCharCode(10);
  return text.split(NL)
    .map(l => l.trim())
    .filter(l => l)
    .map(l => {
      if (l.startsWith('*')) {
        const body = l.replace(/^\*+\s*/, '').replace(/\*+\s*$/, '').trim();
        return '[PLAYER_ACTION] ' + body;
      }
      return '[PLAYER_LINE] ' + l;
    })
    .join(NL);
}

function buildApiMessages(sc, extraUser) {
  const msgs = [{ role: 'system', content: buildSystemPrompt(sc) }];
  for (const m of getSession(sc.id).messages) {
    if (m.kind === 'user') {
      msgs.push({ role: 'user', content: `${sc.userCharName}: ${structureInput(m.content)}` });
    } else {
      const name = m.kind === 'narration' ? t('narrator') : m.charName;
      msgs.push({ role: 'assistant', content: `【${name}】${m.content}` });
    }
  }
  if (extraUser) msgs.push({ role: 'user', content: extraUser });
  return msgs;
}

// ---------- generate ----------
async function generate(opening = false) {
  const sc = getData().scenarios.find(s => s.id === activeScenarioId);
  if (!sc || generating) return;
  const st = getSettings();
  if (!st.baseUrl || !st.model) { alert(t('needSetup')); openSettings(); return; }
  const input = $('#input-box');
  let text = opening ? t('openingPrompt') : input.value.trim();
  if (!opening && !text) text = t('passTurnPrompt'); // empty send: player stays silent, story moves on

  const session = getSession(sc.id);
  if (!opening && text !== t('passTurnPrompt')) {
    // Local verbatim rendering: speech lines right-aligned as-is, * action
    // lines as narration. The DM never re-renders the player's words.
    for (const line of text.split(String.fromCharCode(10))) {
      const t0 = line.trim();
      if (!t0) continue;
      if (t0.startsWith('*')) {
        const body = t0.replace(/^[*]+\s*/, '').replace(/[*]+\s*$/, '').trim();
        if (body) session.messages.push({ kind: 'narration', charName: '', content: body, ts: Date.now() });
      } else {
        session.messages.push({ kind: 'user', charName: sc.userCharName, content: t0, ts: Date.now() });
      }
    }
  }
  persist();
  input.value = '';
  generating = true;              // set before renderChat: renderChat may auto-start an opening
  $('#btn-send').disabled = true;
  $('#input-box').disabled = true;
  $('#dm-status').classList.remove('hidden');
  $('#dm-status-text').textContent = t('dmThinking');
  renderChat();

  // Live segment renderer with a client-side typewriter: network chunks are
  // appended to a buffer, and a ticker reveals characters one by one, so the
  // output always appears gradually even when the provider sends tool
  // arguments in one big chunk at the end.
  let active = null;    // { kind, charName, full, shown, done, bubbleEl, msgEl }
  let segKey = null;    // identity of the current tool call (args events carry it)
  let streamEnded = false;
  let pendingPauseMs = 0;   // DM-requested delay before the next line
  let revealAllowedAt = 0;
  const DEBUG = (() => { try { return localStorage.getItem('storiesDebug') === '1'; } catch { return false; } })();
  let revealT0 = performance.now();
  const commitSegment = () => {
    if (!active) return;
    active.msgEl.classList.remove('typing');
    const text = active.full.trim();
    active.bubbleEl.textContent = text;
    if (!text) {
      active.msgEl.remove();
    } else {
      // The DM may echo the player's line back — keep it right-aligned as user speech.
      const kind = active.charName === sc.userCharName ? 'user' : active.kind;
      session.messages.push({ kind, charName: kind === 'npc' ? active.charName : (kind === 'user' ? sc.userCharName : ''), content: text, ts: Date.now() });
    }
    active = null;
  };

  const finalizeSegment = () => { if (active) active.done = true; };
  const startSegment = (key, kind, charName) => {
    if (active) { active.shown = active.full.length; commitSegment(); }
    segKey = key;
    revealAllowedAt = Date.now() + pendingPauseMs;
    pendingPauseMs = 0;
    revealT0 = performance.now();
    const bubbleEl = addMessageEl({ kind, charName, content: '' }, { typing: true });
    active = { kind, charName, full: '', shown: 0, done: false, bubbleEl, msgEl: bubbleEl.closest('.msg') };
  };
  const updateSegment = (key, kind, charName, text) => {
    if (!active || segKey !== key) {
      // A NEW tool call — even for the same character, it gets its own bubble.
      if (DEBUG) console.debug('%c[stories]%c new segment', 'color:#e0a; font-weight:bold', 'color:inherit', { key, kind, charName });
      startSegment(key, kind, charName);
    } else if (active.kind !== kind || active.charName !== charName) {
      // classification refined as the name finished streaming
      if (active.shown === 0) {
        active.msgEl.remove();
        const bubbleEl = addMessageEl({ kind, charName, content: '' }, { typing: true });
        active.bubbleEl = bubbleEl; active.msgEl = bubbleEl.closest('.msg');
      }
      active.kind = kind; active.charName = charName;
    }
    if (text.length > active.full.length) {
      if (DEBUG && active.full.length === 0 && text.length > 0) {
        console.debug('%c[stories]%c first text', 'color:#e0a; font-weight:bold', 'color:inherit', { text: text.slice(0, 30) });
      }
      active.full = text;
    }
  };
  const ticker = setInterval(() => {
    const a = active;
    if (!a) {
      if (streamEnded) clearInterval(ticker);
      return;
    }
    if (Date.now() < revealAllowedAt) return;
    if (a.shown < a.full.length) {
      // reveal ~50 ticks per full line, at least 1 char per tick
      const lagMs = Math.round(performance.now() - revealT0);
      if (DEBUG) console.debug('%c[stories]%c reveal', 'color:#e0a; font-weight:bold', 'color:inherit', { atMs: lagMs, shown: a.shown, full: a.full.length });
      a.shown = Math.min(a.full.length, a.shown + Math.max(1, Math.ceil(a.full.length / 50)));
      a.bubbleEl.textContent = a.full.slice(0, a.shown);
      $('#messages').scrollTop = $('#messages').scrollHeight;
    }
    if (a.done && a.shown >= a.full.length) commitSegment();
  }, 40);
  const waitForReveal = () => new Promise((resolve) => {
    const started = Date.now();
    const w = setInterval(() => {
      if (!active || Date.now() - started > 10000) { clearInterval(w); resolve(); }
    }, 50);
  });

  // Content-stream live rendering: some providers stream the reply as plain
  // text (tool calls unsupported or ignored). Parse the incremental text and
  // update bubbles as tokens arrive, so output is visible during the stream.
  let full = '';
  let toolSeen = false;
  let contentBubbles = []; // display-only; replaced by renderChat() at the end
  const kindFor = (charName) => {
    if (!charName) return 'narration';
    if (charName === sc.userCharName) return 'user';
    return isNarrator(charName) ? 'narration' : 'npc';
  };
  // Parse the incremental 【Name】text stream and mirror it into bubbles live.
  const renderContentLive = () => {
    const NL = String.fromCharCode(10);
    const lines = full.split(NL);
    const segs = [];
    let cur = null;
    const openSeg = (charName) => {
      cur = { charName, buf: '' };
      segs.push(cur);
    };
    for (const line of lines) {
      if (line.includes('[PLAYER_')) continue; // tag leakage — never display
      const m = line.match(/^【([^】]+)】(.*)$/);
      if (m) { cur = null; openSeg(m[1].trim()); cur.buf = m[2]; }
      else if (cur) { cur.buf += NL + line; }
      // bare lines before any 【】 header are model chatter — ignore
    }
    // drop empty trailing seg
    while (segs.length && !segs[segs.length - 1].buf.trim() && segs[segs.length - 1].charName === '' && segs.length > 1) segs.pop();
    if (!segs.length) return;
    // ensure bubble list matches segs length
    while (contentBubbles.length > segs.length) contentBubbles.pop().msgEl.remove();
    while (contentBubbles.length < segs.length) {
      const seg = segs[contentBubbles.length];
      const kind = kindFor(seg.charName);
      const bubbleEl = addMessageEl({ kind, charName: kind === 'narration' ? '' : seg.charName, content: '' }, { typing: true });
      contentBubbles.push({ seg, bubbleEl, msgEl: bubbleEl.closest('.msg') });
    }
    contentBubbles.forEach((b, i) => {
      const seg = segs[i];
      if (b.seg.charName !== seg.charName) {
        // classification changed (name finished streaming) — rebuild this bubble
        b.msgEl.remove();
        const kind = kindFor(seg.charName);
        const bubbleEl = addMessageEl({ kind, charName: kind === 'narration' ? '' : seg.charName, content: seg.buf }, { typing: true });
        b.bubbleEl = bubbleEl; b.msgEl = bubbleEl.closest('.msg');
      }
      b.seg = seg;
      b.bubbleEl.textContent = seg.buf;
    });
    $('#messages').scrollTop = $('#messages').scrollHeight;
  };
  try {
    let toolSegments = 0;
    await chatStream({
      baseUrl: st.baseUrl, apiKey: st.apiKey, model: st.model, temperature: st.temperature,
      messages: (() => {
        const base = buildApiMessages(sc);
        // opening / silent-pass: hidden OOC user turn, not stored in history
        if (opening || text === t('passTurnPrompt')) base.push({ role: 'user', content: text });
        return base;
      })(),
      tools: RP_TOOLS,
      onDelta: (d) => {
        full += d;
        if (!toolSeen && full.indexOf('【') >= 0) renderContentLive();
      },
      onToolEvent: (ev) => {
        if (DEBUG && ev.type === 'args' && ev.args.length < 60) {
          console.debug('%c[stories]%c seg update', 'color:#e0a; font-weight:bold', 'color:inherit', { name: ev.name, args: ev.args });
        }
        if (ev.type === 'args') {
          toolSeen = true;
          if (contentBubbles.length) { contentBubbles.forEach(b => b.msgEl.remove()); contentBubbles = []; }
          if (ev.name === 'pause') {
            // no visual segment for pauses
          } else if (ev.name === 'narrate') {
            updateSegment(ev.key, 'narration', '', extractPartialString(ev.args, 'text'));
          } else {
            updateSegment(ev.key, 'npc', extractPartialString(ev.args, 'character'), extractPartialString(ev.args, 'text'));
          }
        } else if (ev.type === 'call_end') {
          const parsed = safeParseArgs(ev.args) || {};
          if (ev.name === 'pause') {
            const sec = Number(parsed.seconds);
            if (Number.isFinite(sec) && sec > 0) {
              pendingPauseMs += Math.min(3000, Math.max(300, sec * 1000));
            }
          } else {
            const ok = (ev.name === 'narrate')
              ? !!(parsed.text || '').trim()
              : !!(parsed.text || '').trim() && !!(parsed.character || '').trim();
            if (ok) { toolSegments++; finalizeSegment(); }
          }
        }
      },
    });
    streamEnded = true;
    finalizeSegment();
    await waitForReveal();
    if (toolSegments === 0) {
      // model ignored tools — fall back to parsing plain 【】 formatted output
      const parsed = parseAiReply(full, sc);
      if (!parsed.length && full.trim()) {
        parsed.push({ kind: 'narration', charName: '', content: full.trim(), ts: Date.now() });
      }
      session.messages.push(...parsed);
    }
    persist();
    renderChat();
  } catch (err) {
    streamEnded = true;
    clearInterval(ticker);
    if (active) { active.full = active.full.slice(0, active.shown) || active.full; commitSegment(); }
    if (corsHelpNeeded(err)) {
      openCorsModal();
    } else {
      addMessageEl({ kind: 'narration', charName: '', content: t('errGeneric') + (err.message || err) });
    }
    persist();
  } finally {
    generating = false;
    $('#btn-send').disabled = false;
    $('#input-box').disabled = false;
    $('#dm-status').classList.add('hidden');
  }

}

// ---------- scenario modal ----------
let editingScenarioId = null;

function npcRow(name = '', persona = '') {
  const row = document.createElement('div');
  row.className = 'npc-row';
  row.innerHTML = `
    <input class="npc-name" type="text" placeholder="${t('npcName')}">
    <textarea class="npc-persona" placeholder="${t('npcPersona')}"></textarea>
    <button class="npc-remove" title="✕">✕</button>`;
  row.querySelector('.npc-name').value = name;
  row.querySelector('.npc-persona').value = persona;
  row.querySelector('.npc-remove').onclick = () => row.remove();
  return row;
}

function openScenarioModal(sc = null) {
  editingScenarioId = sc ? sc.id : null;
  $('#scenario-modal-title').textContent = sc ? t('editScenario') : t('newScenario');
  $('#f-name').value = sc ? sc.name : '';
  $('#f-world').value = sc ? sc.worldSetting : '';
  $('#f-userchar').value = sc ? sc.userCharName : '';
  $('#f-userpersona').value = sc ? (sc.userPersona || '') : '';
  $('#f-dm').value = sc ? (sc.dmInstructions || '') : '';
  const ed = $('#npc-editor');
  ed.innerHTML = '';
  const chars = sc ? sc.characters : [{ name: '', persona: '' }];
  if (!chars.length) chars.push({ name: '', persona: '' });
  for (const c of chars) ed.appendChild(npcRow(c.name, c.persona));
  $('#modal-scenario').classList.remove('hidden');
}

function saveScenarioFromModal() {
  const name = $('#f-name').value.trim();
  if (!name) { alert(t('needName')); return; }
  const userCharName = $('#f-userchar').value.trim();
  if (!userCharName) { alert(t('needUserChar')); return; }
  const characters = [...$('#npc-editor').querySelectorAll('.npc-row')]
    .map(r => ({ id: uid(), name: r.querySelector('.npc-name').value.trim(), persona: r.querySelector('.npc-persona').value.trim() }))
    .filter(c => c.name);
  if (!characters.length) { alert(t('needNpc')); return; }
  const sc = editingScenarioId
    ? getData().scenarios.find(s => s.id === editingScenarioId)
    : { id: uid(), createdAt: Date.now() };
  Object.assign(sc, { name, worldSetting: $('#f-world').value.trim(), userCharName, userPersona: $('#f-userpersona').value.trim(), dmInstructions: $('#f-dm').value.trim(), characters });
  upsertScenario(sc);
  $('#modal-scenario').classList.add('hidden');
  selectScenario(sc.id);
}

// ---------- settings modal ----------
function providerOptions() {
  const sel = $('#f-provider');
  sel.innerHTML = '';
  for (const p of PROVIDERS) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
}

function openSettings() {
  const st = getSettings();
  providerOptions();
  $('#f-provider').value = PROVIDERS.some(p => p.id === st.providerId) ? st.providerId : PROVIDERS[0].id;
  const cur = PROVIDERS.find(p => p.id === $('#f-provider').value);
  $('#f-baseurl').value = st.baseUrl || cur.baseUrl;
  $('#f-model').value = st.model || cur.model;
  $('#f-apikey').value = st.apiKey || '';
  $('#test-result').textContent = '';
  $('#modal-settings').classList.remove('hidden');
}

$('#f-provider').addEventListener('change', () => {
  const p = PROVIDERS.find(x => x.id === $('#f-provider').value);
  $('#f-baseurl').value = p.baseUrl;
  $('#f-model').value = p.model;
});

function saveSettingsFromModal() {
  saveSettings({
    providerId: $('#f-provider').value,
    baseUrl: $('#f-baseurl').value.trim(),
    model: $('#f-model').value.trim(),
    apiKey: $('#f-apikey').value.trim(),
  });
  $('#modal-settings').classList.add('hidden');
}

$('#btn-test').addEventListener('click', async () => {
  const el = $('#test-result');
  el.className = 'hint';
  el.textContent = '…';
  const st = {
    baseUrl: $('#f-baseurl').value.trim(),
    apiKey: $('#f-apikey').value.trim(),
    model: $('#f-model').value.trim(),
  };
  try {
    await chatStream({
      ...st, temperature: 0,
      messages: [{ role: 'user', content: 'Say OK.' }],
      onDelta: () => {},
    });
    el.textContent = t('testOk');
    el.classList.add('ok');
  } catch (err) {
    if (corsHelpNeeded(err) && !bridgeAvailable()) {
      el.textContent = t('testFail') + 'CORS';
      el.classList.add('err');
      openCorsModal();
    } else {
      el.textContent = t('testFail') + (err.message || err);
      el.classList.add('err');
    }
  }
});

$('#btn-bridge-save').addEventListener('click', async () => {
  const el = $('#test-result');
  el.className = 'hint';
  if (!bridgeAvailable()) { el.textContent = t('bridgeNotInstalled'); el.classList.add('err'); return; }
  const model = $('#f-model').value.trim();
  const baseUrl = $('#f-baseurl').value.trim();
  try {
    await saveProfileToBridge({
      profile: 'stories-default',
      baseUrl: baseUrl.replace(/\/+$/, ''),
      apiKey: $('#f-apikey').value.trim(),
      name: 'Stories · ' + model,
      model,
    });
    el.textContent = t('bridgeSaved');
    el.classList.add('ok');
  } catch (err) {
    el.textContent = t('bridgeSaveFail') + (err.message || err);
    el.classList.add('err');
  }
});

// ---------- CORS modal ----------
function openCorsModal() {
  $('#modal-cors').classList.remove('hidden');
}
$('#btn-cors-retry').addEventListener('click', () => {
  $('#modal-cors').classList.add('hidden');
  generate();
});

// ---------- wire up ----------
$('#btn-new-scenario').onclick = () => openScenarioModal();
$('#btn-empty-new').onclick = () => openScenarioModal();
$('#btn-settings').onclick = openSettings;
$('#btn-edit-scenario').onclick = () => {
  const sc = getData().scenarios.find(s => s.id === activeScenarioId);
  if (sc) openScenarioModal(sc);
};
$('#btn-save-scenario').onclick = saveScenarioFromModal;
$('#btn-add-npc').onclick = () => $('#npc-editor').appendChild(npcRow());
$('#btn-save-settings').onclick = saveSettingsFromModal;
$('#btn-del-scenario').onclick = () => {
  if (!confirm(t('confirmDelete'))) return;
  deleteScenario(activeScenarioId);
  activeScenarioId = null;
  saveSettings({ activeScenarioId: null });
  renderAll();
};
$('#btn-clear-chat').onclick = () => {
  if (!confirm(t('confirmRestart'))) return;
  clearSession(activeScenarioId);
  renderChat();
};
$('#btn-send').onclick = () => generate();
$('#input-box').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); }
});
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('click', (e) => { if (e.target === m) m.classList.add('hidden'); });
  m.querySelectorAll('.modal-cancel').forEach(b => b.onclick = () => m.classList.add('hidden'));
});

function renderAll() {
  renderScenarioList();
  renderChat();
}

initLang();
activeScenarioId = getSettings().activeScenarioId || null;
renderAll();
