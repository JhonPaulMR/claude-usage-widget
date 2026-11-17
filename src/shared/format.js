// Funções puras de formatação e cálculo (sem Electron, sem rede).

const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000;
const WEEK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function colorBand(pct) {
  if (pct == null || Number.isNaN(pct)) return 'unknown';
  if (pct < 60) return 'green';
  if (pct <= 85) return 'amber';
  return 'red';
}

function clampPct(pct) {
  if (typeof pct !== 'number' || Number.isNaN(pct)) return null;
  return Math.max(0, Math.min(100, pct));
}

// 8100000 -> "2h 15m"; 90000 -> "1m"; > 24h -> "3d 4h"
function formatCountdown(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms <= 0) return 'agora';
  const totalMin = Math.ceil(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// "hoje 18:30", "amanhã 09:00", "qui 09:00"
function formatResetAt(resetsAt, now = Date.now()) {
  if (resetsAt == null) return '—';
  const d = new Date(resetsAt);
  const n = new Date(now);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(d) - startOfDay(n)) / 86400000);
  if (diffDays === 0) return `hoje ${hhmm}`;
  if (diffDays === 1) return `amanhã ${hhmm}`;
  return `${WEEKDAYS[d.getDay()]} ${hhmm}`;
}

// Texto da previsão (resultado de forecast.js). kind: 'session' | 'weekly'.
// Devolve { level: 'ok'|'warn'|'none', pre, strong, post }; strong é a hora pessimista, em destaque.
const FORECAST_NARROW_MS = { session: 5 * 60 * 1000, weekly: 60 * 60 * 1000 };
function forecastText(fc, kind, now = Date.now()) {
  const plain = (level, pre) => ({ level, pre, strong: '', post: '' });
  if (!fc || fc.status === 'none') return plain('none', '');
  if (fc.status === 'limit') return plain('warn', 'limite atingido');
  if (fc.status === 'low') return plain('ok', 'consumo baixo');
  if (fc.status === 'safe') return plain('ok', kind === 'weekly' ? 'não deve acabar nesta semana' : 'não deve acabar nesta sessão');
  const at = (t) => (kind === 'weekly' ? formatResetAt(t, now) : formatClock(t));
  if (fc.latest == null) return { level: 'warn', pre: 'pode acabar a partir de ', strong: at(fc.earliest), post: '' };
  if (fc.latest - fc.earliest < FORECAST_NARROW_MS[kind]) return { level: 'warn', pre: 'acaba por volta de ', strong: at(fc.earliest), post: '' };
  return { level: 'warn', pre: 'acaba entre ', strong: at(fc.earliest), post: ` e ${at(fc.latest)}` };
}

// A previsão está velha quando o último dado tem mais de 2 intervalos de idade.
function forecastIsStale(fetchedAt, intervalSec, now = Date.now()) {
  if (!fetchedAt || !intervalSec) return false;
  return now - fetchedAt > 2 * intervalSec * 1000;
}

// 100000 -> "1:40"; usado na contagem para a próxima tentativa
function formatMmSs(ms) {
  const total = Math.max(0, Math.ceil((ms || 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatClock(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const api = {
  SESSION_WINDOW_MS,
  WEEK_WINDOW_MS,
  colorBand,
  clampPct,
  formatCountdown,
  formatResetAt,
  forecastText,
  forecastIsStale,
  formatMmSs,
  formatClock,
};

// Node (testes) usa module.exports; o renderer carrega como script clássico.
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else window.fmt = api;
