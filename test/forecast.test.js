const test = require('node:test');
const assert = require('node:assert/strict');
const { findBursts, recentRate, habitualRate, forecastSession, forecastWeekly, forecastAll } = require('../src/main/forecast');

const MIN = 60000;
const H = 60 * MIN;
const DAY = 24 * H;
const NOW = new Date(2026, 10, 16, 14, 0).getTime(); // segunda, 14:00

// Amostras de minuto em minuto de `from` até `to`; pctAt(t) devolve a porcentagem (inteira) naquele instante.
function sample(from, to, pctAt, step = MIN) {
  const out = [];
  for (let t = from; t <= to; t += step) out.push({ t, p: Math.floor(pctAt(t)) });
  return out;
}

test('findBursts: degraus próximos formam uma rajada; ocioso longo separa', () => {
  const pts = sample(NOW - 2 * H, NOW, (t) => {
    const m = (t - (NOW - 2 * H)) / MIN;
    if (m <= 20) return 10 + m / 2; // 1% a cada 2 min
    if (m <= 80) return 20; // 1 h parado
    return 20 + (m - 80) / 4; // 1% a cada 4 min
  });
  const bursts = findBursts(pts);
  assert.equal(bursts.length, 2);
  assert.ok(Math.abs(bursts[0].rise / bursts[0].duration - 0.5 / MIN) < 0.05 / MIN);
  assert.ok(Math.abs(bursts[1].rise / bursts[1].duration - 0.25 / MIN) < 0.03 / MIN);
});

test('findBursts: reset e buraco nas amostras não viram subida', () => {
  const pts = [
    { t: 0, p: 80 }, { t: MIN, p: 81 }, { t: 2 * MIN, p: 2 }, // reset
    { t: 3 * MIN, p: 2 }, { t: 3 * H, p: 40 }, // widget fechado por 3 h
  ];
  const bursts = findBursts(pts);
  assert.equal(bursts.length, 1);
  assert.equal(bursts[0].rise, 1);
});

test('recentRate: ignora o tempo ocioso e mede o ritmo do uso ativo', () => {
  // 3 h parado e depois 20 min a 1%/min
  const pts = sample(NOW - 4 * H, NOW, (t) => (t < NOW - 20 * MIN ? 5 : 5 + (t - (NOW - 20 * MIN)) / MIN));
  const r = recentRate(pts, NOW);
  assert.equal(r.active, true);
  assert.ok(Math.abs(r.rate - 1 / MIN) < 0.1 / MIN, `ritmo ${r.rate * MIN}`);
});

test('recentRate: dá mais peso ao trecho mais recente', () => {
  // 10 min a 0,5%/min e depois 10 min a 2%/min
  const pts = sample(NOW - 20 * MIN, NOW, (t) => {
    const m = (t - (NOW - 20 * MIN)) / MIN;
    return m <= 10 ? m / 2 : 5 + (m - 10) * 2;
  });
  const r = recentRate(pts, NOW);
  assert.ok(r.rate > 1.25 / MIN && r.rate < 2 / MIN, `ritmo ${r.rate * MIN}`);
});

test('recentRate: parado há mais de 15 min deixa de estar ativo, mas guarda o último ritmo', () => {
  const pts = sample(NOW - 2 * H, NOW, (t) => Math.min(30, ((t - (NOW - 2 * H)) / MIN)));
  const r = recentRate(pts, NOW);
  assert.equal(r.active, false);
  assert.ok(Math.abs(r.rate - 1 / MIN) < 0.1 / MIN);
  assert.equal(recentRate(sample(NOW - H, NOW, () => 7), NOW), null);
});

test('forecastSession: faixa entre o ritmo recente (pessimista) e a média da janela (otimista)', () => {
  // janela começou há 2 h; 1h40 parado em 20% e depois 20 min a 1%/min => 40%
  const resetsAt = NOW + 3 * H;
  const pts = sample(NOW - 2 * H, NOW, (t) => (t < NOW - 20 * MIN ? 20 : 20 + (t - (NOW - 20 * MIN)) / MIN));
  const fc = forecastSession({ pct: 40, resetsAt }, pts, NOW);
  assert.equal(fc.status, 'range');
  // pessimista: 60% restantes a ~1%/min => ~1 h
  assert.ok(Math.abs(fc.earliest - (NOW + H)) < 8 * MIN, `pessimista em ${(fc.earliest - NOW) / MIN} min`);
  // otimista: média 40% em 2 h => 100% em +3 h, que é o próprio reset: não acaba
  assert.equal(fc.latest, null);
  assert.ok(fc.activeEndsAt != null);
});

test('forecastSession: os dois extremos antes do reset', () => {
  const resetsAt = NOW + 4 * H; // janela começou há 1 h
  const pts = sample(NOW - H, NOW, (t) => 50 * ((t - (NOW - H)) / H)); // constante: 50% em 1 h
  const fc = forecastSession({ pct: 50, resetsAt }, pts, NOW);
  assert.equal(fc.status, 'range');
  assert.ok(Math.abs(fc.earliest - (NOW + H)) < 10 * MIN);
  assert.ok(Math.abs(fc.latest - (NOW + H)) < 10 * MIN);
  assert.ok(fc.earliest <= fc.latest);
});

test('forecastSession: ritmo tranquilo não acaba; casos sem dados', () => {
  const resetsAt = NOW + H;
  const pts = sample(NOW - 4 * H, NOW, (t) => 12 * ((t - (NOW - 4 * H)) / (4 * H)));
  assert.equal(forecastSession({ pct: 12, resetsAt }, pts, NOW).status, 'safe');
  assert.equal(forecastSession({ pct: 100, resetsAt }, pts, NOW).status, 'limit');
  assert.equal(forecastSession({ pct: 0, resetsAt }, [], NOW).status, 'low');
  assert.equal(forecastSession(null, [], NOW).status, 'none');
  assert.equal(forecastSession({ pct: 50, resetsAt: NOW - 1 }, [], NOW).status, 'none'); // janela já virou
});

test('forecastSession: não mistura a janela anterior', () => {
  const resetsAt = NOW + 4.5 * H; // janela nova começou há 30 min
  const before = sample(NOW - 3 * H, NOW - 40 * MIN, (t) => 60 + 30 * ((t - (NOW - 3 * H)) / (140 * MIN)));
  const after = sample(NOW - 30 * MIN, NOW, () => 1);
  const fc = forecastSession({ pct: 1, resetsAt }, before.concat(after), NOW);
  assert.equal(fc.status, 'safe');
});

// Três semanas de histórico com uma rajada forte toda segunda às 14h (1,5%/min por 20 min).
function habitHistory() {
  let pts = [];
  for (let week = 3; week >= 1; week--) {
    const start = NOW - week * 7 * DAY;
    pts = pts.concat(sample(start - 10 * MIN, start + 30 * MIN, (t) => Math.max(0, Math.min(30, 1.5 * ((t - start) / MIN)))));
  }
  return pts;
}

test('habitualRate: percentil 75 das rajadas no mesmo dia e horário, só com 7 dias de histórico', () => {
  const pts = habitHistory();
  const r = habitualRate(pts, NOW);
  assert.ok(Math.abs(r - 1.5 / MIN) < 0.2 / MIN, `habitual ${r * MIN}`);
  assert.equal(habitualRate(pts, NOW + 6 * H), null); // 20h: sem rajadas nesse horário
  const recentOnly = pts.filter((x) => x.t > NOW - 8 * DAY).map((x) => ({ t: x.t + 3 * DAY, p: x.p }));
  assert.equal(habitualRate(recentOnly, NOW), null); // menos de 7 dias
});

test('forecastSession: com histórico, o pessimista usa o ritmo forte habitual', () => {
  const resetsAt = NOW + 4 * H;
  const today = sample(NOW - H, NOW, (t) => 10 * ((t - (NOW - H)) / H)); // hoje: devagar, 10% em 1 h
  const fc = forecastSession({ pct: 10, resetsAt }, habitHistory().concat(today), NOW);
  assert.equal(fc.status, 'range');
  assert.equal(fc.habitual, true);
  assert.ok(Math.abs(fc.earliest - (NOW + H)) < 10 * MIN); // 90% a 1,5%/min = 1 h
  assert.equal(fc.activeEndsAt, null); // pelo uso de agora não acabaria: sem alerta
});

test('forecastWeekly: últimas 24 h contra a média da semana', () => {
  const resetsAt = NOW + 2 * DAY; // 5 dias decorridos
  const pts = sample(NOW - 5 * DAY, NOW, (t) => (t < NOW - DAY ? 40 * ((t - (NOW - 5 * DAY)) / (4 * DAY)) : 40 + 30 * ((t - (NOW - DAY)) / DAY)), 10 * MIN);
  const fc = forecastWeekly({ pct: 70, resetsAt }, pts, NOW);
  assert.equal(fc.status, 'range');
  assert.ok(Math.abs(fc.earliest - (NOW + DAY)) < 2 * H); // 30% a 30%/dia
  assert.equal(fc.latest, null); // pela média (14%/dia) levaria 2,1 dias: passa do reset
  assert.equal(forecastWeekly({ pct: 20, resetsAt }, [], NOW).status, 'safe');
});

test('forecastAll: lê as linhas do histórico e ignora valores nulos', () => {
  const rows = [[NOW - 2 * MIN, 10, 50], [NOW - MIN, null, 50], [NOW, 11, null]];
  const fc = forecastAll({ session: { pct: 11, resetsAt: NOW + 4 * H }, weekly: null }, rows, NOW);
  assert.ok(['range', 'safe'].includes(fc.session.status));
  assert.equal(fc.weekly.status, 'none');
});
