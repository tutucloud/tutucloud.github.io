// Persistence: everything lives in localStorage under one key.
const KEY = 'stories.data.v1';

const defaults = {
  settings: { providerId: 'openai', baseUrl: '', apiKey: '', model: '', temperature: 0.8, lang: 'auto', activeScenarioId: null },
  scenarios: [],
  sessions: {}, // scenarioId -> { messages: [...] }
};

let data = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(defaults);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(defaults), ...parsed };
  } catch {
    return structuredClone(defaults);
  }
}

export function getData() { return data; }

export function persist() {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function getSettings() { return data.settings; }

export function saveSettings(patch) {
  Object.assign(data.settings, patch);
  persist();
}

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

export function upsertScenario(sc) {
  const i = data.scenarios.findIndex(s => s.id === sc.id);
  if (i >= 0) data.scenarios[i] = sc; else data.scenarios.push(sc);
  persist();
}

export function deleteScenario(id) {
  data.scenarios = data.scenarios.filter(s => s.id !== id);
  delete data.sessions[id];
  persist();
}

export function getSession(scenarioId) {
  if (!data.sessions[scenarioId]) data.sessions[scenarioId] = { messages: [] };
  return data.sessions[scenarioId];
}

export function clearSession(scenarioId) {
  data.sessions[scenarioId] = { messages: [] };
  persist();
}
