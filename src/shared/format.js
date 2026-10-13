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

// Extrapolação linear dentro da janela atual.
// Retorna { level: 'ok'|'warn'|'none', text }
function paceProjection(pct, resetsAt, windowMs, now = Date.now()) {
  if (pct == null || resetsAt == null) return { level: 'none', text: '' };
  const remaining = resetsAt - now;
  const elapsed = windowMs - remaining;
  if (pct >= 100) return { level: 'warn', text: 'limite atingido' };
  if (elapsed <= 60000 || pct <= 0) return { level: 'ok', text: 'consumo baixo' };
  const rate = pct / elapsed; // % por ms
  const toLimit = (100 - pct) / rate;
  if (toLimit < remaining) {
    return { level: 'warn', text: `no ritmo de acabar em ~${formatCountdown(toLimit)}` };
  }
  return { level: 'ok', text: 'ritmo confortável' };
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
  paceProjection,
  formatClock,
};

// Node (testes) usa module.exports; o renderer carrega como script clássico.
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else window.fmt = api;
