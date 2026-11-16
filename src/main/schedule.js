// Regras puras de agendamento das consultas (sem Electron, sem rede).

const BACKOFF_FACTOR = 1.5;
const BACKOFF_MAX_SEC = 300;
const OFFLINE_RETRY_SEC = 15;
const SERVER_RETRY_SEC = 30;
const AUTH_RETRY_SEC = 60;

// Próxima espera depois de um 429. Se o servidor disse quanto esperar (Retry-After), vale o que ele disse.
function nextBackoffSec(prevSec, intervalSec, retryAfterSec) {
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(Math.max(Math.ceil(retryAfterSec), intervalSec), BACKOFF_MAX_SEC);
  }
  const base = Math.max(prevSec || 0, intervalSec);
  return Math.min(Math.ceil(base * BACKOFF_FACTOR), Math.max(BACKOFF_MAX_SEC, intervalSec));
}

// Segundos até a próxima consulta, conforme o estado atual.
function nextDelaySec(state, intervalSec, backoffSec) {
  if (state === 'offline') return Math.min(intervalSec, OFFLINE_RETRY_SEC);
  if (state === 'server') return Math.min(intervalSec, SERVER_RETRY_SEC);
  if (state === 'auth' || state === 'format') return Math.max(intervalSec, AUTH_RETRY_SEC);
  if (state === 'ratelimit') return Math.max(intervalSec, backoffSec || 0);
  return intervalSec;
}

// Cabeçalho Retry-After: segundos ("120") ou data HTTP. Devolve segundos ou null.
function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n >= 0 ? n : null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - now) / 1000));
}

module.exports = { nextBackoffSec, nextDelaySec, parseRetryAfter, BACKOFF_MAX_SEC };
