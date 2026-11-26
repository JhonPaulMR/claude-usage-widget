// Regras puras de agendamento das consultas (sem Electron, sem rede).

const BACKOFF_FACTOR = 1.5;
const BACKOFF_MAX_SEC = 300;
const OFFLINE_RETRY_SEC = 15;
const SERVER_RETRY_SEC = 30;
const AUTH_RETRY_SEC = 60;
const ERROR_RETRY_SEC = 30;
const STUCK_MS = 45000; // consulta pendente há mais que isso (prazo da rede é 15 s): considera presa
const OVERDUE_GRACE_MS = 30000; // timer atrasado além disso (suspensão, relógio): consulta na hora

// Próxima espera depois de um 429. Se o servidor disse quanto esperar (Retry-After), vale o que ele disse.
function nextBackoffSec(prevSec, intervalSec, retryAfterSec) {
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(Math.max(Math.ceil(retryAfterSec), intervalSec), BACKOFF_MAX_SEC);
  }
  const base = Math.max(prevSec || 0, intervalSec);
  return Math.min(Math.ceil(base * BACKOFF_FACTOR), Math.max(BACKOFF_MAX_SEC, intervalSec));
}

// Depois de um 429 seguido de sucesso, o ritmo volta ao intervalo aos poucos (÷1,5 por consulta boa).
// Voltar direto ao intervalo cheio provocava outro 429 logo em seguida.
function decayBackoffSec(backoffSec, intervalSec) {
  if (!backoffSec || backoffSec <= intervalSec) return 0;
  const next = Math.floor(backoffSec / BACKOFF_FACTOR);
  return next <= intervalSec ? 0 : next;
}

// Segundos até a próxima consulta, conforme o estado atual.
function nextDelaySec(state, intervalSec, backoffSec) {
  if (state === 'ok') return Math.max(intervalSec, backoffSec || 0);
  if (state === 'error') return Math.max(intervalSec, ERROR_RETRY_SEC);
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

// Uma consulta começou há tempo demais e não terminou: a próxima pode passar por cima dela.
function isStuck(startedAt, now = Date.now()) {
  return startedAt != null && now - startedAt > STUCK_MS;
}

// A consulta agendada já devia ter acontecido (timer perdido ou atrasado pela suspensão).
function isOverdue(nextAt, now = Date.now()) {
  return nextAt != null && now - nextAt > OVERDUE_GRACE_MS;
}

module.exports = { nextBackoffSec, decayBackoffSec, nextDelaySec, parseRetryAfter, isStuck, isOverdue, BACKOFF_MAX_SEC, STUCK_MS, OVERDUE_GRACE_MS };
