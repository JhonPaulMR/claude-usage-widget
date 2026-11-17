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

test('previsão abaixo de 15 min avisa uma vez por janela, só pelo uso de agora', () => {
  const sent = [];
  const check = createAlerter((t) => sent.push(t));
  const now = 10 * H;
  const data = { session: { pct: 70, resetsAt: now + 2 * H } };
  const fc = (activeEndsAt) => ({ session: { status: 'range', earliest: now + 60000, activeEndsAt } });
  check(data, [], { forecast: fc(now + 40 * 60000), now }); // 40 min: ainda não
  check(data, [], { forecast: fc(null), now }); // só ritmo habitual, pessoa parada
  check(data, [], { forecast: null, now }); // aviso desligado
  assert.equal(sent.length, 0);
  check(data, [], { forecast: fc(now + 12 * 60000), now });
  check(data, [], { forecast: fc(now + 8 * 60000), now });
  assert.deepEqual(sent, ['Sessão de 5h: acaba em ~12 min']);
  check({ session: { pct: 70, resetsAt: now + 7 * H } }, [], { forecast: fc(now + 5 * 60000), now });
  assert.equal(sent.length, 2);
});

test('limiar e previsão na mesma consulta geram um aviso só', () => {
  const sent = [];
  const check = createAlerter((t) => sent.push(t));
  const forecast = { session: { status: 'range', activeEndsAt: 5 * 60000 } };
  check({ session: { pct: 92, resetsAt: H } }, [80, 90], { forecast, now: 0 });
  assert.equal(sent.length, 1);
  check({ session: { pct: 93, resetsAt: H } }, [80, 90], { forecast, now: 0 });
  assert.equal(sent.length, 2);
});
