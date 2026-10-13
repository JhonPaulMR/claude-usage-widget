const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOauth, normalizeHeaders } = require('../src/main/usageProvider');

test('normalizeOauth: sessão, semanal e modelos', () => {
  const out = normalizeOauth({
    five_hour: { utilization: 12.5, resets_at: '2026-10-13T18:00:00Z' },
    seven_day: { utilization: 40, resets_at: '2026-10-16T09:00:00Z' },
    seven_day_opus: { utilization: 7, resets_at: '2026-10-16T09:00:00Z' },
    extra_usage: { is_enabled: false },
  });
  assert.equal(out.session.pct, 12.5);
  assert.equal(out.session.resetsAt, Date.parse('2026-10-13T18:00:00Z'));
  assert.equal(out.weekly.pct, 40);
  assert.deepEqual(out.models.map((m) => m.label), ['Opus']);
});

test('normalizeOauth: formato inesperado vira erro "format"', () => {
  assert.throws(() => normalizeOauth({ foo: 1 }), (e) => e.kind === 'format');
  assert.throws(() => normalizeOauth(null), (e) => e.kind === 'format');
});

test('normalizeHeaders: fração -> porcentagem, reset em epoch segundos', () => {
  const h = new Headers({
    'anthropic-ratelimit-unified-5h-utilization': '0.25',
    'anthropic-ratelimit-unified-5h-reset': '1800000000',
    'anthropic-ratelimit-unified-7d-utilization': '0.5',
    'anthropic-ratelimit-unified-7d-reset': '1800500000',
  });
  const out = normalizeHeaders(h);
  assert.equal(out.session.pct, 25);
  assert.equal(out.session.resetsAt, 1800000000 * 1000);
  assert.equal(out.weekly.pct, 50);
  assert.throws(() => normalizeHeaders(new Headers()), (e) => e.kind === 'format');
});
