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

test('paceProjection: avisa quando vai estourar antes do reset', () => {
  const now = 1_000_000_000_000;
  const win = f.SESSION_WINDOW_MS;
  // 1h decorrida de 5h, 50% usado => 100% em +1h, bem antes do reset (+4h)
  const warn = f.paceProjection(50, now + 4 * 3600000, win, now);
  assert.equal(warn.level, 'warn');
  assert.match(warn.text, /~1h/);
  // 4h decorridas, 10% usado => confortável
  assert.equal(f.paceProjection(10, now + 3600000, win, now).level, 'ok');
  assert.equal(f.paceProjection(100, now + 3600000, win, now).text, 'limite atingido');
  assert.equal(f.paceProjection(null, null, win, now).level, 'none');
});
