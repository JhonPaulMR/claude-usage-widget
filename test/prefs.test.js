const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitize, migrate, pick, alertThresholds, RULES } = require('../src/main/prefs');
const { DEFAULTS } = require('../src/main/store');

test('sanitize: aceita valores válidos e recusa o resto', () => {
  assert.deepEqual(sanitize('intervalSec', 120), { ok: true, value: 120 });
  assert.equal(sanitize('intervalSec', 10).ok, false); // 10 s provocaria 429
  assert.equal(sanitize('intervalSec', 180).ok, false);
  assert.deepEqual(sanitize('chartMode', 'combined'), { ok: true, value: 'combined' });
  assert.equal(sanitize('chartMode', 'pizza').ok, false);
  assert.equal(sanitize('chartRange', '7d').ok, true);
  assert.equal(sanitize('compactChart', 'true').ok, false);
  assert.deepEqual(sanitize('alertLow', '75'), { ok: true, value: 75 });
  assert.equal(sanitize('alertLow', 0).ok, false);
  assert.equal(sanitize('alertHigh', 100).ok, false);
  assert.deepEqual(sanitize('displayId', null), { ok: true, value: null });
  assert.equal(sanitize('displayId', 'x').ok, false);
});

test('sanitize: chave fora da lista é recusada (a janela não grava o que quiser)', () => {
  for (const key of ['last', 'top', 'visible', 'autostartInit', '__proto__', 'constructor', 'toString']) {
    assert.equal(sanitize(key, true).ok, false, key);
  }
});

test('toda preferência editável tem padrão válido no store', () => {
  for (const key of Object.keys(RULES)) {
    assert.ok(key in DEFAULTS, `sem padrão: ${key}`);
    assert.equal(sanitize(key, DEFAULTS[key]).ok, true, `padrão inválido: ${key}`);
  }
});

test('migrate: intervalo que deixou de existir vai para o válido logo abaixo', () => {
  assert.deepEqual(migrate({ intervalSec: 180 }), { intervalSec: 120 });
  assert.deepEqual(migrate({ intervalSec: 10 }), { intervalSec: 30 });
  assert.deepEqual(migrate({ intervalSec: 60 }), {});
});

test('alertThresholds: só os limiares ligados, sem repetir', () => {
  const get = (o) => (k) => o[k];
  assert.deepEqual(alertThresholds(get({ alert80: true, alert90: true, alertLow: 70, alertHigh: 95 })), [70, 95]);
  assert.deepEqual(alertThresholds(get({ alert80: false, alert90: true, alertLow: 70, alertHigh: 95 })), [95]);
  assert.deepEqual(alertThresholds(get({ alert80: true, alert90: true, alertLow: 85, alertHigh: 85 })), [85]);
});

test('pick: devolve só as preferências editáveis', () => {
  const out = pick((k) => DEFAULTS[k]);
  assert.deepEqual(Object.keys(out).sort(), Object.keys(RULES).sort());
  assert.equal('last' in out, false);
});
