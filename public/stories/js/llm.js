// LLM access: direct fetch first; on network/CORS failure, fall back to the
// llm-bridge browser extension (postMessage). All providers use the
// OpenAI-compatible /chat/completions protocol, with streaming and
// tool-calling support.

let bridgeReady = false;
// Set localStorage.storiesDebug = '1' to log chunk timing to the console.
const DEBUG = (() => { try { return localStorage.getItem('storiesDebug') === '1'; } catch { return false; } })();
const dbg = (msg, obj) => { if (DEBUG) console.debug('%c[stories]' + '%c ' + msg, 'color:#7c6cf0;font-weight:bold', 'color:inherit', obj ?? ''); };
const pending = new Map();

function initBridgeListener() {
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || typeof msg.id !== 'string') return;
    if (msg.type === 'llm-bridge.ready') {
      bridgeReady = true;
      return;
    }
    if (msg.type === 'llm-bridge.response' || msg.type === 'llm-bridge.error') {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p(msg); }
    }
  });
  // probe in case the extension was loaded before us
  window.postMessage({ id: 'probe-' + Date.now(), type: 'llm-bridge.ping' }, location.origin);
}
initBridgeListener();

export function bridgeAvailable() {
  return bridgeReady;
}

function bridgeCall(type, payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    if (!bridgeReady) return reject(new Error('BRIDGE_NOT_INSTALLED'));
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('BRIDGE_TIMEOUT'));
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.type === 'llm-bridge.error') {
        reject(new Error(msg.payload?.code || 'BRIDGE_ERROR'));
      } else {
        resolve(msg.payload);
      }
    });
    window.postMessage({ id, type, payload }, location.origin);
  });
}

export async function saveProfileToBridge({ profile, baseUrl, apiKey, name, model }) {
  await bridgeCall('llm-bridge.secret.set', { profile, baseUrl, apiKey, name, model });
}

function isNetworkError(err) {
  return err instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(String(err?.message));
}

// Streaming chat completion.
// - Text mode: onDelta(chunk) fires with plain content increments.
// - Tool mode: pass `tools`; onToolEvent fires with
//   { type: 'call_start'|'args'|'call_end', key, name, args } where `args`
//   is the accumulated arguments JSON string for that call.
// Returns the full plain content (for fallback parsing).
export async function chatStream({ baseUrl, apiKey, model, messages, tools, temperature = 0.8, onDelta, onToolEvent, signal }) {
  const endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const bodyObj = { model, messages, temperature, stream: true };
  if (tools) bodyObj.tools = tools;
  const body = JSON.stringify(bodyObj);

  const emitTool = (ev) => { try { onToolEvent?.(ev); } catch { /* listener error */ } };

  const makeAccum = () => {
    const calls = new Map(); // key -> { name, args, started }
    return {
      feed(key, name, argFragment) {
        let c = calls.get(key);
        if (!c) {
          c = { name: name || '', args: '', started: false };
          calls.set(key, c);
        }
        if (name) c.name = name;
        if (argFragment) c.args += argFragment;
        if (!c.started && (c.name || c.args)) {
          c.started = true;
          emitTool({ type: 'call_start', key, name: c.name });
        }
        if (c.args) emitTool({ type: 'args', key, name: c.name, args: c.args });
        return c;
      },
      // Heuristic for bridge streams where semantics may be cumulative
      // snapshots rather than fragments: if the new text extends the buffer,
      // replace; otherwise append.
      feedSmart(key, name, argText) {
        const c = calls.get(key);
        if (c && argText && c.args && argText.startsWith(c.args)) {
          c.args = argText;
        } else {
          return this.feed(key, name, argText);
        }
        if (c.args) emitTool({ type: 'args', key, name: c.name, args: c.args });
        return c;
      },
      endAll() {
        for (const [key, c] of calls) {
          if (c.started) emitTool({ type: 'call_end', key, name: c.name, args: c.args });
        }
      },
    };
  };

  const tryDirect = async () => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body,
      signal,
    });
    if (!res.ok) throw new Error('HTTP_' + res.status + ': ' + (await res.text()).slice(0, 300));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const accum = tools ? makeAccum() : null;
    let buf = '', full = '';
    const t0 = performance.now();
    while (true) {
      const { done, value } = await reader.read();
      if (done) { dbg('stream done', { atMs: Math.round(performance.now() - t0) }); break; }
      dbg('chunk arrived', { atMs: Math.round(performance.now() - t0), bytes: value.byteLength });
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const data = s.slice(5).trim();
        if (data === '[DONE]') continue;
        let json;
        try { json = JSON.parse(data); } catch { continue; }
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) { full += delta.content; onDelta?.(delta.content); }
        if (accum && delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const key = tc.index ?? tc.id ?? 0;
            dbg('tool_call delta', { atMs: Math.round(performance.now() - t0), key, name: tc.function?.name, frag: tc.function?.arguments });
            accum.feed(key, tc.function?.name, tc.function?.arguments);
          }
        }
      }
    }
    if (accum) accum.endAll();
    return full;
  };

  const tryBridge = async () => {
    if (!bridgeReady) throw new Error('BRIDGE_NOT_INSTALLED');
    const profile = 'stories-default';
    // (Re)register profile so the extension injects the key; empty apiKey keeps stored key.
    await bridgeCall('llm-bridge.secret.set', {
      profile, baseUrl: baseUrl.replace(/\/+$/, ''), apiKey: apiKey || '', name: 'Stories · ' + model, model,
    });
    let full = '';
    const accum = tools ? makeAccum() : null;
    const requestId = crypto.randomUUID();
    await new Promise((resolve, reject) => {
      const onMsg = (ev) => {
        if (ev.source !== window) return;
        const msg = ev.data;
        if (!msg || msg.id !== requestId) return;
        if (msg.type === 'llm-bridge.stream') {
          const p = msg.payload || {};
          if (p.delta) { full += p.delta; onDelta?.(p.delta); }
          if (accum && p.toolCalls) {
            for (const tc of p.toolCalls) {
              const key = tc.index ?? tc.id ?? 0;
              accum.feedSmart(key, tc.name, tc.arguments || '');
            }
          }
          if (p.done) { if (accum) accum.endAll(); cleanup(); resolve(); }
        } else if (msg.type === 'llm-bridge.error') {
          cleanup(); reject(new Error(msg.payload?.code || 'BRIDGE_ERROR'));
        }
      };
      const cleanup = () => window.removeEventListener('message', onMsg);
      window.addEventListener('message', onMsg);
      window.postMessage({
        id: requestId, type: 'llm-bridge.request',
        // the extension stringifies payload.body itself — pass the object,
        // passing a string here would double-encode the request
        payload: { profile, endpoint, body: bodyObj },
      }, location.origin);
    });
    return full;
  };

  try {
    return await tryDirect();
  } catch (err) {
    if (isNetworkError(err) && bridgeReady) {
      return await tryBridge();
    }
    throw err;
  }
}

// GET /models — direct first, bridge fallback (same strategy as chatStream).
export async function listModels({ baseUrl, apiKey }) {
  const endpoint = baseUrl.replace(/\/+$/, '') + '/models';
  const parse = (bodyText) => {
    const data = JSON.parse(bodyText);
    const arr = Array.isArray(data) ? data : (data.data || data.models || []);
    return arr.map(m => m.id || m.name || m.model).filter(Boolean);
  };
  const tryDirect = async () => {
    const res = await fetch(endpoint, { headers: { 'Authorization': 'Bearer ' + apiKey } });
    if (!res.ok) throw new Error('HTTP_' + res.status);
    return parse(await res.text());
  };
  const tryBridge = async () => {
    if (!bridgeReady) throw new Error('BRIDGE_NOT_INSTALLED');
    const profile = 'stories-default';
    await bridgeCall('llm-bridge.secret.set', { profile, baseUrl: baseUrl.replace(/\/+$/, ''), apiKey: apiKey || '', name: 'Stories' });
    const payload = await bridgeCall('llm-bridge.get', { profile, endpoint });
    return parse(payload.body);
  };
  try {
    return await tryDirect();
  } catch (err) {
    if (isNetworkError(err) && bridgeReady) return await tryBridge();
    throw err;
  }
}

export function corsHelpNeeded(err) {
  return isNetworkError(err);
}
