// Séries dos gráficos a partir do histórico (funções puras). O histórico pode ter dezenas de
// milhares de pontos; para a interface vai no máximo um ponto por faixa de tempo do gráfico.

const HOUR = 3600000;
const SESSION_WINDOW_MS = 5 * HOUR;
const WEEK_WINDOW_MS = 168 * HOUR;
const MAX_POINTS = 120;
const FUTURE_SHARE = 0.2; // no modo combinado, parte do eixo fica à frente de "agora" para a projeção

// rows: linhas [t, sessão, semanal] em ordem de tempo; idx: 1 ou 2.
// Devolve [[t, pct]] entre from e to, guardando o último ponto de cada faixa.
function downsample(rows, idx, from, to, maxPoints = MAX_POINTS) {
  const span = to - from;
  if (!(span > 0)) return [];
  const out = [];
  let lastBucket = -1;
  for (const r of rows) {
    const t = r[0];
    if (t < from) continue;
    if (t > to) break;
    const p = r[idx];
    if (typeof p !== 'number') continue;
    const bucket = Math.min(maxPoints - 1, Math.floor(((t - from) / span) * maxPoints));
    if (bucket === lastBucket) out[out.length - 1] = [t, p];
    else { out.push([t, p]); lastBucket = bucket; }
  }
  return out;
}

// Eixo de uma janela de limite: do início da janela até o reset. Sem reset conhecido, as últimas horas.
function windowAxis(item, windowMs, now) {
  if (item && item.resetsAt && item.resetsAt > now) return { from: item.resetsAt - windowMs, to: item.resetsAt };
  return { from: now - windowMs, to: now };
}

// opts: { mode, rangeMs }. Devolve { session, weekly, combined } com { from, to, points } cada;
// combined só existe no modo combinado e traz as duas séries no mesmo eixo de tempo.
function buildCharts(data, rows, now, opts = {}) {
  const one = (item, idx, windowMs) => {
    const axis = windowAxis(item, windowMs, now);
    return { ...axis, points: downsample(rows, idx, axis.from, Math.min(axis.to, now)) };
  };
  const out = {
    session: one(data && data.session, 1, SESSION_WINDOW_MS),
    weekly: one(data && data.weekly, 2, WEEK_WINDOW_MS),
    combined: null,
  };
  if (opts.mode === 'combined' && opts.rangeMs > 0) {
    const from = now - opts.rangeMs;
    out.combined = {
      from,
      to: now + opts.rangeMs * FUTURE_SHARE,
      session: downsample(rows, 1, from, now),
      weekly: downsample(rows, 2, from, now),
    };
  }
  return out;
}

module.exports = { downsample, windowAxis, buildCharts, MAX_POINTS };
