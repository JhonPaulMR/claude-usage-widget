const test = require('node:test');
const assert = require('node:assert/strict');
const { downsample, buildCharts, MAX_POINTS } = require('../src/main/chart');
const spark = require('../src/shared/sparkline');
const f = require('../src/shared/format');

const MIN = 60000;
const H = 60 * MIN;
const NOW = 1_800_000_000_000;

function rows(from, to, step, fn) {
  const out = [];
  for (let t = from; t <= to; t += step) out.push([t, ...fn(t)]);
  return out;
}

test('downsample: no máximo um ponto por faixa, guardando o mais recente', () => {
  const r = rows(NOW - 7 * 24 * H, NOW, MIN, (t) => [1, Math.floor(((t - (NOW - 7 * 24 * H)) / (7 * 24 * H)) * 60)]);
  const out = downsample(r, 2, NOW - 7 * 24 * H, NOW);
  assert.ok(out.length <= MAX_POINTS && out.length > MAX_POINTS - 2);
  assert.deepEqual(out[out.length - 1], [NOW, 60]);
  for (let i = 1; i < out.length; i++) assert.ok(out[i][0] > out[i - 1][0]);
});

test('downsample: respeita o intervalo e pula valores nulos', () => {
  const r = [[NOW - 3 * H, 1, 1], [NOW - 2 * H, null, 5], [NOW - H, 7, 6], [NOW + H, 9, 9]];
  assert.deepEqual(downsample(r, 1, NOW - 2.5 * H, NOW), [[NOW - H, 7]]);
  assert.deepEqual(downsample(r, 1, NOW, NOW), []);
});

test('buildCharts: sessão e semanal usam a janela do limite; combinado só no modo combinado', () => {
  const r = rows(NOW - 10 * H, NOW, MIN, () => [20, 40]);
  const data = { session: { pct: 20, resetsAt: NOW + 2 * H }, weekly: { pct: 40, resetsAt: NOW + 48 * H } };
  const c = buildCharts(data, r, NOW, { mode: 'separate', rangeMs: 5 * H });
  assert.equal(c.session.from, NOW - 3 * H);
  assert.equal(c.session.to, NOW + 2 * H);
  assert.ok(c.session.points.every(([t]) => t >= NOW - 3 * H && t <= NOW));
  assert.equal(c.weekly.to, NOW + 48 * H);
  assert.equal(c.combined, null);

  const comb = buildCharts(data, r, NOW, { mode: 'combined', rangeMs: H }).combined;
  assert.equal(comb.from, NOW - H);
  assert.ok(comb.to > NOW); // sobra eixo à frente para a projeção
  assert.ok(comb.session.length > 0 && comb.weekly.length > 0);
});

test('buildCharts: sem reset conhecido, mostra as últimas horas', () => {
  const c = buildCharts({ session: null, weekly: null }, [], NOW, {});
  assert.equal(c.session.to, NOW);
  assert.equal(c.session.from, NOW - 5 * H);
  assert.deepEqual(c.session.points, []);
});

test('segments: quebra o traço no reset e em buraco de amostras', () => {
  const pts = [[0, 10], [10 * MIN, 20], [20 * MIN, 5], [30 * MIN, 6], [3 * H, 8], [3 * H + 10 * MIN, 9]];
  const segs = spark.segments(pts, 0, 5 * H, 200, 36);
  assert.equal(segs.length, 3);
  assert.deepEqual(segs.map((s) => s.length), [2, 2, 2]);
  assert.deepEqual(segs[0][0], [0, spark.toY(10, 36)]);
});

test('toY, linePath e areaPath', () => {
  assert.equal(spark.toY(0, 36), 35);
  assert.equal(spark.toY(100, 36), 1);
  assert.equal(spark.toY(250, 36), 1);
  const segs = [[[0, 30], [10, 20]], [[50, 10]]];
  assert.equal(spark.linePath(segs), 'M0 30L10 20M50 10h0.5');
  assert.equal(spark.areaPath(segs, 36), 'M0 36L0 30L10 20L10 36Z');
});

test('projection: até o limite, até o reset, e cortada no fim do eixo', () => {
  const item = { pct: 40, resetsAt: NOW + 3 * H };
  assert.deepEqual(spark.projection(item, { status: 'range', earliest: NOW + H }, NOW, NOW + 3 * H), [[NOW, 40], [NOW + H, 100]]);
  // não acaba: sobe 10%/h até o reset
  assert.deepEqual(spark.projection(item, { status: 'safe', rate: 10 / H }, NOW, NOW + 3 * H), [[NOW, 40], [NOW + 3 * H, 70]]);
  // eixo termina em 30 min: metade do caminho até 100%
  assert.deepEqual(spark.projection(item, { status: 'range', earliest: NOW + H }, NOW, NOW + 30 * MIN), [[NOW, 40], [NOW + 30 * MIN, 70]]);
  assert.equal(spark.projection(item, { status: 'low' }, NOW, NOW + H), null);
  assert.equal(spark.projection(null, { status: 'range', earliest: NOW + H }, NOW, NOW + H), null);
});

test('forecastShort: só a hora pessimista, para a aba recolhida', () => {
  const now = new Date(2026, 9, 13, 10, 0).getTime(); // terça
  const at = (h, m, d = 13) => new Date(2026, 9, d, h, m).getTime();
  assert.deepEqual(f.forecastShort({ status: 'range', earliest: at(14, 20) }, 'session', now), { level: 'warn', text: '14:20' });
  assert.equal(f.forecastShort({ status: 'range', earliest: at(14, 20) }, 'weekly', now).text, '14:20');
  assert.equal(f.forecastShort({ status: 'range', earliest: at(3, 27, 15) }, 'weekly', now).text, 'qui 03h');
  assert.deepEqual(f.forecastShort({ status: 'safe' }, 'session', now), { level: 'ok', text: 'ok' });
  assert.equal(f.forecastShort({ status: 'limit' }, 'session', now).text, 'limite');
  assert.equal(f.forecastShort(null, 'session', now).text, '');
});
