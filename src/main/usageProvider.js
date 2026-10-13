// ÚNICO módulo que fala com a rede. Se a Anthropic mudar o endpoint/formato, é só aqui.
// O token é lido do arquivo do Claude Code a cada consulta e nunca é logado nem guardado.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CRED_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 15000;

class UsageError extends Error {
  // kind: 'auth' | 'network' | 'format' | 'ratelimit'
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

function readToken(now = Date.now()) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8')).claudeAiOauth;
  } catch {
    throw new UsageError('auth', 'Credenciais do Claude Code não encontradas');
  }
  if (!raw || !raw.accessToken) throw new UsageError('auth', 'Sem token no arquivo de credenciais');
  if (raw.expiresAt && raw.expiresAt < now) {
    throw new UsageError('auth', 'Token expirado — abra o Claude Code para renovar');
  }
  return raw.accessToken;
}

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v; // segundos -> ms
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

const MODEL_LABELS = {
  seven_day_opus: 'Opus',
  seven_day_sonnet: 'Sonnet',
  seven_day_oauth_apps: 'Apps OAuth',
  seven_day_cowork: 'Cowork',
};

// Formato esperado do endpoint: { five_hour: {utilization, resets_at}, seven_day: {...}, seven_day_opus: {...} ... }
function normalizeOauth(json) {
  if (!json || typeof json !== 'object') throw new UsageError('format', 'Resposta vazia');
  const pick = (o) => {
    if (!o || typeof o !== 'object' || typeof o.utilization !== 'number') return null;
    return { pct: o.utilization, resetsAt: toMs(o.resets_at) };
  };
  const session = pick(json.five_hour);
  const weekly = pick(json.seven_day);
  if (!session && !weekly) throw new UsageError('format', 'Formato inesperado da resposta de uso');
  const models = [];
  for (const [key, value] of Object.entries(json)) {
    if (key === 'seven_day' || key === 'five_hour') continue;
    const p = pick(value);
    if (p) models.push({ label: MODEL_LABELS[key] || key.replace(/^seven_day_?/, '') || key, ...p });
  }
  return { session, weekly, models };
}

// Plano B: cabeçalhos anthropic-ratelimit-unified-* (utilização em fração 0..1, reset em epoch s)
function normalizeHeaders(headers) {
  const get = (n) => headers.get(`anthropic-ratelimit-unified-${n}`);
  const pick = (w) => {
    const u = parseFloat(get(`${w}-utilization`));
    if (Number.isNaN(u)) return null;
    return { pct: u * 100, resetsAt: toMs(Number(get(`${w}-reset`)) || null) };
  };
  const session = pick('5h');
  const weekly = pick('7d');
  if (!session && !weekly) throw new UsageError('format', 'Cabeçalhos de limite ausentes');
  return { session, weekly, models: [] };
}

async function request(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    throw new UsageError('network', 'Sem conexão');
  } finally {
    clearTimeout(timer);
  }
}

function classifyStatus(res) {
  if (res.status === 401 || res.status === 403) {
    return new UsageError('auth', 'Sessão expirada — abra o Claude Code');
  }
  if (res.status === 429) return new UsageError('ratelimit', 'Muitas consultas, aguardando');
  return new UsageError('format', `Resposta HTTP ${res.status}`);
}

async function fetchViaUsageEndpoint(token) {
  const res = await request(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-usage-widget/0.1',
    },
  });
  if (!res.ok) throw classifyStatus(res);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new UsageError('format', 'Resposta não é JSON');
  }
  return normalizeOauth(json);
}

// Gasta uma quantidade mínima de uso (1 token). Só roda se o endpoint principal falhar por formato.
async function fetchViaHeaders(token) {
  const res = await request(MESSAGES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'User-Agent': 'claude-usage-widget/0.1',
    },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    // 429 ainda pode trazer cabeçalhos úteis
    if (res.status !== 429) throw classifyStatus(res);
  }
  return normalizeHeaders(res.headers);
}

async function fetchUsage() {
  const token = readToken();
  try {
    return await fetchViaUsageEndpoint(token);
  } catch (e) {
    if (e.kind !== 'format') throw e;
    return fetchViaHeaders(token);
  }
}

// Dados simulados para desenvolvimento/demonstração (sem rede, sem token).
function fetchDemo(now = Date.now()) {
  const wave = (period, lo, hi) => lo + ((Math.sin(now / period) + 1) / 2) * (hi - lo);
  return {
    session: { pct: wave(90000, 20, 96), resetsAt: now + 2 * 3600000 + 15 * 60000 },
    weekly: { pct: wave(200000, 35, 78), resetsAt: now + 3 * 86400000 + 4 * 3600000 },
    models: [
      { label: 'Opus', pct: 38, resetsAt: now + 3 * 86400000 },
      { label: 'Sonnet', pct: 55, resetsAt: now + 3 * 86400000 },
    ],
  };
}

module.exports = { fetchUsage, fetchDemo, normalizeOauth, normalizeHeaders, UsageError };
