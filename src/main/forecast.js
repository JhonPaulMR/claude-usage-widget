// Previsão de quando o limite acaba (funções puras, sem Electron, sem rede).
//
// O endpoint só fornece porcentagens inteiras, então o ritmo não é medido consulta a consulta:
// é medido entre "degraus" (momentos em que a porcentagem subiu). Degraus próximos formam uma
// rajada de uso; um intervalo longo sem degrau é tempo ocioso e fica fora do cálculo.

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SESSION_WINDOW_MS = 5 * HOUR;
const WEEK_WINDOW_MS = 7 * DAY;

const IDLE_MS = 15 * MIN; // sem degrau por mais que isso: ocioso
const LOOKBACK_ACTIVE_MS = 20 * MIN; // quanto de uso ativo recente entra no ritmo pessimista
const HALF_LIFE_MS = 10 * MIN; // peso cai pela metade a cada 10 min de uso ativo para trás
const LEAD_MS = 5 * MIN; // duração atribuída a uma rajada de um degrau só
const HABIT_MIN_HISTORY_MS = 7 * DAY;
const HABIT_MIN_BURST_MS = 5 * MIN;
const HABIT_MIN_BURSTS = 3;
const WEEK_RECENT_MS = DAY;
const WEEK_RECENT_MIN_SPAN_MS = 2 * HOUR;

// points: [{ t, p }] em ordem crescente de t. Devolve rajadas { first, last, units: [{ t, dt, dp }] }.
// Queda de porcentagem (reset) e buraco nas amostras (widget fechado) encerram a rajada, e a subida
// observada através de um buraco é descartada, porque não se sabe quanto tempo ela levou.
function findBursts(points) {
  const bursts = [];
  let cur = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dp = b.p - a.p;
    if (dp < 0 || b.t - a.t > IDLE_MS) { cur = null; continue; }
    if (dp === 0) continue;
    if (cur && b.t - cur.last <= IDLE_MS) {
      cur.units.push({ t: b.t, dt: b.t - cur.last, dp });
      cur.last = b.t;
    } else {
      cur = { first: b.t, last: b.t, units: [{ t: b.t, dt: 0, dp }] };
      bursts.push(cur);
    }
  }
  // O primeiro degrau de cada rajada não tem intervalo anterior: recebe o espaçamento médio da rajada.
  for (const b of bursts) {
    const n = b.units.length;
    b.lead = n > 1 ? Math.min(IDLE_MS, Math.max(MIN, (b.last - b.first) / (n - 1))) : LEAD_MS;
    b.units[0].dt = b.lead;
    b.duration = b.last - b.first + b.lead;
    b.rise = b.units.reduce((s, u) => s + u.dp, 0);
  }
  return bursts;
}

// Ritmo (% por ms) dos últimos 20 min de uso ativo, com mais peso no mais recente.
// active = houve degrau há menos de IDLE_MS (a pessoa está usando agora).
function recentRate(points, now) {
  const bursts = findBursts(points);
  if (!bursts.length) return null;
  const lastBurst = bursts[bursts.length - 1];
  const trailing = now - lastBurst.last;
  const active = trailing <= IDLE_MS;
  const units = [];
  // Tempo sem degrau desde o último: conta como uso ativo sem subida, o que faz o ritmo cair aos poucos.
  if (active && trailing > lastBurst.lead) units.push({ dt: trailing - lastBurst.lead, dp: 0 });
  for (let i = bursts.length - 1; i >= 0; i--) {
    for (let j = bursts[i].units.length - 1; j >= 0; j--) units.push(bursts[i].units[j]);
  }
  let acc = 0, num = 0, den = 0;
  for (const u of units) {
    if (u.dt <= 0) continue;
    const take = Math.min(u.dt, LOOKBACK_ACTIVE_MS - acc);
    const w = Math.pow(0.5, (acc + take / 2) / HALF_LIFE_MS);
    num += w * u.dp * (take / u.dt);
    den += w * take;
    acc += take;
    if (acc >= LOOKBACK_ACTIVE_MS) break;
  }
  if (den <= 0 || num <= 0) return null;
  return { rate: num / den, active };
}

function percentile(sorted, q) {
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}

// Ritmo forte habitual: percentil 75 das rajadas no mesmo dia da semana e horário (±1 h).
// Sem rajadas suficientes nesse recorte, usa o mesmo horário em qualquer dia. Exige 7 dias de histórico.
function habitualRate(points, now) {
  if (!points.length || now - points[0].t < HABIT_MIN_HISTORY_MS) return null;
  const n = new Date(now);
  const bursts = findBursts(points).filter((b) => b.units.length >= 2 && b.duration >= HABIT_MIN_BURST_MS);
  const sameHour = bursts.filter((b) => {
    const diff = Math.abs(new Date(b.first).getHours() - n.getHours());
    return Math.min(diff, 24 - diff) <= 1;
  });
  const sameDay = sameHour.filter((b) => new Date(b.first).getDay() === n.getDay());
  const pick = sameDay.length >= HABIT_MIN_BURSTS ? sameDay : sameHour.length >= HABIT_MIN_BURSTS ? sameHour : null;
  if (!pick) return null;
  return percentile(pick.map((b) => b.rise / b.duration).sort((a, b) => a - b), 0.75);
}

// Monta o resultado comum a sessão e semanal.
//   status: 'none' sem dados | 'limit' já em 100% | 'low' sem ritmo medido | 'safe' não acaba antes
//           do reset | 'range' acaba antes do reset
//   rate: ritmo pessimista (% por ms), usado na linha de projeção do gráfico
//   earliest: hora pessimista; latest: hora otimista (null se o ritmo lento não chega ao limite)
//   activeEndsAt: hora prevista só pelo uso de agora (para o alerta); null se a pessoa não está usando
function build(pct, resetsAt, now, rates) {
  const fastList = [rates.avg, rates.recent, rates.habitual].filter((r) => r > 0);
  if (!fastList.length) return { status: 'low' };
  const slowList = [rates.avg, rates.recent].filter((r) => r > 0);
  const fast = Math.max(...fastList);
  const slow = slowList.length ? Math.min(...slowList) : fast;
  const left = 100 - pct;
  const earliest = now + left / fast;
  const latest = now + left / slow;
  const activeRate = rates.active ? Math.max(rates.recent || 0, rates.avg || 0) : 0;
  const activeEndsAt = activeRate > 0 && now + left / activeRate < resetsAt ? now + left / activeRate : null;
  if (earliest >= resetsAt) return { status: 'safe', rate: fast };
  return { status: 'range', rate: fast, earliest, latest: latest < resetsAt ? latest : null, activeEndsAt, habitual: rates.habitual > 0 && fast === rates.habitual };
}

function windowAverage(pct, resetsAt, windowMs, now) {
  const elapsed = now - (resetsAt - windowMs);
  return elapsed > MIN && pct > 0 ? pct / elapsed : null;
}

function usable(item, now) {
  return item && typeof item.pct === 'number' && item.resetsAt && item.resetsAt > now;
}

// item: { pct, resetsAt }; points: histórico inteiro da sessão [{ t, p }].
function forecastSession(item, points, now) {
  if (!usable(item, now)) return { status: 'none' };
  if (item.pct >= 100) return { status: 'limit' };
  const start = item.resetsAt - SESSION_WINDOW_MS;
  const recent = recentRate(points.filter((x) => x.t >= start && x.t <= now), now);
  return build(item.pct, item.resetsAt, now, {
    avg: windowAverage(item.pct, item.resetsAt, SESSION_WINDOW_MS, now),
    recent: recent && recent.rate,
    active: !!(recent && recent.active),
    habitual: habitualRate(points, now),
  });
}

// Semanal: o ritmo recente é o das últimas 24 h corridas (inclui o tempo ocioso, que numa
// projeção de dias é realista); o otimista continua sendo a média da janela.
function forecastWeekly(item, points, now) {
  if (!usable(item, now)) return { status: 'none' };
  if (item.pct >= 100) return { status: 'limit' };
  const from = Math.max(item.resetsAt - WEEK_WINDOW_MS, now - WEEK_RECENT_MS);
  const first = points.find((x) => x.t >= from && x.t <= now);
  let recent = null;
  if (first && now - first.t >= WEEK_RECENT_MIN_SPAN_MS && item.pct > first.p) recent = (item.pct - first.p) / (now - first.t);
  return build(item.pct, item.resetsAt, now, {
    avg: windowAverage(item.pct, item.resetsAt, WEEK_WINDOW_MS, now),
    recent,
    active: recent != null,
  });
}

// history: linhas [t, sessão, semanal]. Devolve { session, weekly }.
function forecastAll(data, history, now = Date.now()) {
  const series = (i) => history.filter((h) => typeof h[i] === 'number').map((h) => ({ t: h[0], p: h[i] }));
  return {
    session: forecastSession(data && data.session, series(1), now),
    weekly: forecastWeekly(data && data.weekly, series(2), now),
  };
}

module.exports = { findBursts, recentRate, habitualRate, forecastSession, forecastWeekly, forecastAll, IDLE_MS };
