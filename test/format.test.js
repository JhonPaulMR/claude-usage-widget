const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/shared/format');

test('colorBand: faixas verde/âmbar/vermelho', () => {
  assert.equal(f.colorBand(0), 'green');
  assert.equal(f.colorBand(59.9), 'green');
  assert.equal(f.colorBand(60), 'amber');
  assert.equal(f.colorBand(85), 'amber');
  assert.equal(f.colorBand(85.1), 'red');
  assert.equal(f.colorBand(null), 'unknown');
});

test('clampPct limita 0..100 e rejeita não-números', () => {
  assert.equal(f.clampPct(120), 100);
  assert.equal(f.clampPct(-5), 0);
  assert.equal(f.clampPct('x'), null);
});

test('formatCountdown', () => {
  assert.equal(f.formatCountdown(2 * 3600000 + 15 * 60000), '2h 15m');
  assert.equal(f.formatCountdown(90000), '2m');
  assert.equal(f.formatCountdown(3 * 86400000 + 4 * 3600000), '3d 4h');
  assert.equal(f.formatCountdown(0), 'agora');
  assert.equal(f.formatCountdown(null), '—');
});

test('formatResetAt: hoje, amanhã e dia da semana', () => {
  const now = new Date(2026, 9, 13, 10, 0).getTime(); // terça
  assert.equal(f.formatResetAt(new Date(2026, 9, 13, 18, 30).getTime(), now), 'hoje 18:30');
  assert.equal(f.formatResetAt(new Date(2026, 9, 14, 9, 0).getTime(), now), 'amanhã 09:00');
  assert.equal(f.formatResetAt(new Date(2026, 9, 16, 9, 0).getTime(), now), 'sex 09:00');
});

test('forecastText: faixa, destaque no pessimista e casos fixos', () => {
  const now = new Date(2026, 9, 13, 10, 0).getTime(); // terça
  const at = (h, m, d = 13) => new Date(2026, 9, d, h, m).getTime();
  assert.deepEqual(f.forecastText({ status: 'range', earliest: at(14, 20), latest: at(15, 10) }, 'session', now),
    { level: 'warn', pre: 'acaba entre ', strong: '14:20', post: ' e 15:10' });
  assert.deepEqual(f.forecastText({ status: 'range', earliest: at(14, 20), latest: null }, 'session', now),
    { level: 'warn', pre: 'pode acabar a partir de ', strong: '14:20', post: '' });
  assert.equal(f.forecastText({ status: 'range', earliest: at(14, 20), latest: at(14, 22) }, 'session', now).pre, 'acaba por volta de ');
  const week = f.forecastText({ status: 'range', earliest: at(9, 0, 14), latest: at(18, 30, 16) }, 'weekly', now);
  assert.equal(week.strong, 'amanhã 09:00');
  assert.equal(week.post, ' e sex 18:30');
  assert.equal(f.forecastText({ status: 'safe' }, 'session', now).pre, 'não deve acabar nesta sessão');
  assert.equal(f.forecastText({ status: 'safe' }, 'weekly', now).pre, 'não deve acabar nesta semana');
  assert.equal(f.forecastText({ status: 'limit' }, 'session', now).pre, 'limite atingido');
  assert.equal(f.forecastText({ status: 'low' }, 'session', now).level, 'ok');
  assert.equal(f.forecastText(null, 'session', now).level, 'none');
});

test('forecastIsStale: mais de 2 intervalos sem dado novo', () => {
  const now = 1_000_000_000_000;
  assert.equal(f.forecastIsStale(now - 119000, 60, now), false);
  assert.equal(f.forecastIsStale(now - 121000, 60, now), true);
  assert.equal(f.forecastIsStale(null, 60, now), false);
});
