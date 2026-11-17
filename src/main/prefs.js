// Preferências que a janela de configurações pode ler e alterar (regras puras, sem Electron).
// Qualquer valor vindo da janela passa por sanitize(); chave fora da lista é recusada.

const HOUR = 3600000;
const INTERVALS = [30, 60, 120, 300]; // também é o intervalo dos pontos do gráfico
const CHART_MODES = ['separate', 'combined', 'session', 'weekly'];
const CHART_RANGES = { '1h': HOUR, '5h': 5 * HOUR, '24h': 24 * HOUR, '7d': 168 * HOUR };

// Atalhos oferecidos para chamar o mascote até o mouse ('none' desliga).
const CALL_KEYS = ['Control+Alt+M', 'Control+Shift+M', 'Control+Alt+Space', 'F8', 'none'];

const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);
const percent = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 99 ? n : undefined;
};

const RULES = {
  intervalSec: oneOf(INTERVALS),
  chartMode: oneOf(CHART_MODES),
  chartRange: oneOf(Object.keys(CHART_RANGES)),
  compactSession: bool,
  compactWeekly: bool,
  compactForecast: bool,
  compactReset: bool,
  compactChart: bool,
  alert80: bool, // liga o primeiro limiar (alertLow)
  alert90: bool, // liga o segundo limiar (alertHigh)
  alertLow: percent,
  alertHigh: percent,
  alertForecast: bool,
  autoRenew: bool,
  autoRenewPaid: bool,
  paidFallback: bool,
  theme: oneOf(['dark', 'light']),
  autostart: bool,
  demo: bool,
  mode: oneOf(['classic', 'mascot']),
  mascotMove: oneOf(['fixed', 'walk']),
  mascotFreq: oneOf(['rare', 'normal', 'often']),
  mascotNotify: bool,
  mascotEmote: oneOf(['auto', 'neutro', 'feliz', 'cansado', 'preocupado', 'confuso', 'morto']),
  mascotCallKey: oneOf(CALL_KEYS),
};

// Devolve { ok, value }. ok=false: chave desconhecida ou valor inválido.
function sanitize(key, value) {
  const rule = Object.prototype.hasOwnProperty.call(RULES, key) ? RULES[key] : null;
  if (!rule) return { ok: false };
  const v = rule(value);
  return v === undefined ? { ok: false } : { ok: true, value: v };
}

// Corrige valores antigos que deixaram de existir. Devolve só as chaves que mudam.
function migrate(all) {
  const fix = {};
  if (!INTERVALS.includes(all.intervalSec)) {
    // maior intervalo válido que não passa do antigo (180 -> 120); abaixo do mínimo vira o mínimo
    const lower = INTERVALS.filter((s) => s <= all.intervalSec);
    fix.intervalSec = lower.length ? lower[lower.length - 1] : INTERVALS[0];
  }
  return fix;
}

function pick(get) {
  const out = {};
  for (const k of Object.keys(RULES)) out[k] = get(k);
  return out;
}

// Limiares de alerta ligados, sem repetição.
function alertThresholds(get) {
  const list = [];
  if (get('alert80')) list.push(get('alertLow'));
  if (get('alert90')) list.push(get('alertHigh'));
  return [...new Set(list.filter((n) => Number.isFinite(n)))];
}

module.exports = { CALL_KEYS, INTERVALS, CHART_MODES, CHART_RANGES, RULES, sanitize, migrate, pick, alertThresholds };
