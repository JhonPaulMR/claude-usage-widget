const test = require('node:test');
const assert = require('node:assert/strict');
const { createAlerter } = require('../src/main/alerts');

const H = 3600000;

test('dispara 80% e 90% uma vez por janela', () => {
  const sent = [];
  const check = createAlerter((t) => sent.push(t));
  const reset = 1_000_000;
  check({ session: { pct: 70, resetsAt: reset } }, [80, 90]);
  assert.equal(sent.length, 0);
  check({ session: { pct: 82, resetsAt: reset } }, [80, 90]);
  check({ session: { pct: 83, resetsAt: reset } }, [80, 90]);
  assert.equal(sent.length, 1);
  check({ session: { pct: 91, resetsAt: reset } }, [80, 90]);
  assert.equal(sent.length, 2);
  check({ session: { pct: 95, resetsAt: reset } }, [80, 90]);
  assert.equal(sent.length, 2);
});

test('pular direto para 95% gera um único aviso', () => {
  const sent = [];
  const check = createAlerter((t) => sent.push(t));
  check({ weekly: { pct: 95, resetsAt: 5 } }, [80, 90]);
  check({ weekly: { pct: 96, resetsAt: 5 } }, [80, 90]);
  assert.equal(sent.length, 1);
});

test('nova janela (reset adiante) reativa os avisos', () => {
  const sent = [];
  const check = createAlerter((t) => sent.push(t));
  check({ session: { pct: 85, resetsAt: 1 * H } }, [80]);
  check({ session: { pct: 85, resetsAt: 1 * H + 1000 } }, [80]); // jitter: não repete
  assert.equal(sent.length, 1);
  check({ session: { pct: 85, resetsAt: 6 * H } }, [80]);
  assert.equal(sent.length, 2);
});

test('respeita limiares desativados', () => {
  const sent = [];
  const check = createAlerter((t) => sent.push(t));
  check({ session: { pct: 99, resetsAt: 1 } }, []);
  assert.equal(sent.length, 0);
});
