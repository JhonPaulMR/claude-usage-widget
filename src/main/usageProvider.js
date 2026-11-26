// ÚNICO módulo que fala com a rede. Se a Anthropic mudar o endpoint/formato, é só aqui.
// O token é lido do arquivo do Claude Code a cada consulta e nunca é logado nem guardado.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseRetryAfter } = require('./schedule');

const CRED_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 15000;
const USER_AGENT = `claude-usage-widget/${require('../../package.json').version}`;

class UsageError extends Error {
  // kind: 'auth' | 'network' | 'server' | 'format' | 'ratelimit'
  // expired: token vencido (dá para renovar); retryAfterSec: espera pedida pelo servidor num 429
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
    const err = new UsageError('auth', 'Token expirado — abra o Claude Code para renovar');
    err.expired = true;
    throw err;
  }
  return raw.accessToken;
}

// Validade do token em ms (epoch), ou null se não der para ler. Nunca devolve o token.
function readExpiry() {
  try {
    const raw = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8')).claudeAiOauth;
    return raw && typeof raw.expiresAt === 'number' ? raw.expiresAt : null;
  } catch {
    return null;
  }
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

// Dentro do Electron usa a pilha de rede do Chromium (net.fetch): proxy e certificados do Windows,
// e descarta conexões mortas quando a rede muda ou o PC volta da suspensão. O fetch do Node (undici)
// não faz nada disso e deixava o widget preso em "sem conexão" até reiniciar. Fora do Electron
// (testes, scripts) cai no fetch global.
function defaultFetch() {
  try {
    const { net } = require('electron');
    if (net && typeof net.fetch === 'function') return net.fetch.bind(net);
  } catch {
    /* fora do Electron */
  }
  return fetch;
}

// Código curto do motivo de uma falha de rede, para o diagnóstico (ECONNRESET, net::ERR_..., etc.).
function networkDetail(e) {
  const c = e && e.cause;
  const code = (c && (c.code || c.message)) || (e && e.message) || '';
  return String(code).slice(0, 120);
}

// Faz a requisição e lê o corpo inteiro dentro do mesmo prazo: antes o prazo valia só até os
// cabeçalhos, e um corpo que nunca chegava deixava a consulta pendurada para sempre.
async function request(url, init, { fetchImpl = defaultFetch(), timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    const body = await res.text();
    return { status: res.status, ok: res.ok, headers: res.headers, body };
  } catch (e) {
    const err = timedOut
      ? new UsageError('network', `Sem resposta em ${Math.round(timeoutMs / 1000)} s`)
      : new UsageError('network', 'Sem conexão');
    err.detail = timedOut ? 'timeout' : networkDetail(e);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function classifyStatus(res) {
  if (res.status === 401 || res.status === 403) {
    return new UsageError('auth', 'Sessão expirada — abra o Claude Code');
  }
  if (res.status === 429) {
    const err = new UsageError('ratelimit', 'Muitas consultas, aguardando');
    err.retryAfterSec = parseRetryAfter(res.headers && res.headers.get('retry-after'));
    return err;
  }
  // 5xx (e 408) é falha passageira do servidor: tenta de novo, sem acionar o plano B.
  if (res.status >= 500 || res.status === 408) {
    return new UsageError('server', `Servidor indisponível (HTTP ${res.status})`);
  }
  return new UsageError('format', `Resposta HTTP ${res.status}`);
}

async function fetchViaUsageEndpoint(token, opts) {
  const res = await request(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': USER_AGENT,
    },
  }, opts);
  if (!res.ok) {
    const err = classifyStatus(res);
    err.status = res.status;
    throw err;
  }
  let json;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new UsageError('format', 'Resposta não é JSON');
  }
  return normalizeOauth(json);
}

// Gasta uma quantidade mínima de uso (1 token). Só roda se o endpoint principal mudar de formato
// E o usuário tiver ligado o plano B (desligado por padrão).
async function fetchViaHeaders(token, opts) {
  const res = await request(MESSAGES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      model: 'claude-haiku-5-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  }, opts);
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    // 429 ainda pode trazer cabeçalhos úteis
    if (res.status !== 429) throw classifyStatus(res);
  }
  return normalizeHeaders(res.headers);
}

// opts.fetchImpl / opts.timeoutMs: injetáveis para teste.
async function fetchUsage({ allowPaidFallback = false, ...opts } = {}) {
  const token = readToken();
  try {
    return await fetchViaUsageEndpoint(token, opts);
  } catch (e) {
    if (e.kind !== 'format' || !allowPaidFallback) throw e;
    return fetchViaHeaders(token, opts);
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

module.exports = { fetchUsage, fetchDemo, normalizeOauth, normalizeHeaders, classifyStatus, readExpiry, request, UsageError, CRED_PATH };
