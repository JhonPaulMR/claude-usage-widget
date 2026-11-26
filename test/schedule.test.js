const test = require('node:test');
const assert = require('node:assert/strict');
const { nextBackoffSec, nextDelaySec, parseRetryAfter } = require('../src/main/schedule');
const { classifyStatus } = require('../src/main/usageProvider');
const { formatMmSs } = require('../src/shared/format');

test('backoff: cresce 1,5x a partir do intervalo e para em 5 min', () => {
  assert.equal(nextBackoffSec(0, 60), 90);
  assert.equal(nextBackoffSec(90, 60), 135);
  assert.equal(nextBackoffSec(135, 60), 203);
  assert.equal(nextBackoffSec(203, 60), 300);
  assert.equal(nextBackoffSec(300, 60), 300);
});

test('backoff: Retry-After vale mais que a regra, dentro de [intervalo, 5 min]', () => {
  assert.equal(nextBackoffSec(0, 60, 100), 100);
  assert.equal(nextBackoffSec(200, 60, 10), 60);
  assert.equal(nextBackoffSec(0, 60, 3600), 300);
});

test('espera por estado', () => {
  assert.equal(nextDelaySec('ok', 60, 0), 60);
  assert.equal(nextDelaySec('ok', 60, 90), 90); // depois de um 429, volta ao intervalo aos poucos
  assert.equal(nextDelaySec('error', 60, 0), 60);
  assert.equal(nextDelaySec('error', 30, 0), 30);
  assert.equal(nextDelaySec('ratelimit', 60, 90), 90);
  assert.equal(nextDelaySec('offline', 60, 0), 15);
  assert.equal(nextDelaySec('server', 60, 0), 30);
  assert.equal(nextDelaySec('server', 30, 0), 30);
  assert.equal(nextDelaySec('auth', 30, 0), 60);
});

test('parseRetryAfter: segundos, data HTTP e lixo', () => {
  assert.equal(parseRetryAfter('120'), 120);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter('abc'), null);
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.equal(parseRetryAfter('Mon, 16 Nov 2026 12:01:30 GMT', now), 90);
});

test('classifyStatus: 5xx é passageiro e não aciona o plano B', () => {
  const res = (status, headers = {}) => ({ status, headers: new Headers(headers) });
  assert.equal(classifyStatus(res(500)).kind, 'server');
  assert.equal(classifyStatus(res(503)).kind, 'server');
  assert.equal(classifyStatus(res(401)).kind, 'auth');
  assert.equal(classifyStatus(res(404)).kind, 'format');
  const rl = classifyStatus(res(429, { 'retry-after': '45' }));
  assert.equal(rl.kind, 'ratelimit');
  assert.equal(rl.retryAfterSec, 45);
});

test('formatMmSs', () => {
  assert.equal(formatMmSs(100000), '1:40');
  assert.equal(formatMmSs(5000), '0:05');
  assert.equal(formatMmSs(-1), '0:00');
});
