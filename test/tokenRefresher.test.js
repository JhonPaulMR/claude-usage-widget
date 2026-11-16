const test = require('node:test');
const assert = require('node:assert/strict');
const { createTokenRefresher, COOLDOWN_MS, FREE_ARGS, PAID_ARGS } = require('../src/main/tokenRefresher');

// Simula o CLI: `renewOn` diz qual comando faz o token voltar a valer.
function setup({ renewOn = null, cliOpen = 0, exe = 'claude.exe' } = {}) {
  const s = { now: 1000, expiry: 500, calls: [] };
  const refresher = createTokenRefresher({
    findExe: () => exe,
    run: async (_exe, args) => {
      s.calls.push(args);
      if ((renewOn === 'free' && args === FREE_ARGS) || (renewOn === 'paid' && args === PAID_ARGS)) s.expiry = s.now + 8 * 3600000;
      return true;
    },
    countCli: async () => cliOpen,
    readExpiry: () => s.expiry,
    now: () => s.now,
  });
  return { s, refresher };
}

test('token ainda válido: não chama o CLI', async () => {
  const { s, refresher } = setup();
  s.expiry = 5000;
  assert.deepEqual(await refresher.refresh(), { ok: true, tier: 'none' });
  assert.equal(s.calls.length, 0);
});

test('comando gratuito renova: não gasta uso', async () => {
  const { s, refresher } = setup({ renewOn: 'free' });
  assert.deepEqual(await refresher.refresh({ allowPaid: true }), { ok: true, tier: 'free' });
  assert.deepEqual(s.calls, [FREE_ARGS]);
});

test('gratuito não renova e pago permitido: usa a requisição mínima', async () => {
  const { s, refresher } = setup({ renewOn: 'paid' });
  assert.deepEqual(await refresher.refresh({ allowPaid: true }), { ok: true, tier: 'paid' });
  assert.deepEqual(s.calls, [FREE_ARGS, PAID_ARGS]);
});

test('pago desligado: para no comando gratuito', async () => {
  const { s, refresher } = setup({ renewOn: 'paid' });
  assert.deepEqual(await refresher.refresh({ allowPaid: false }), { ok: false, reason: 'paid-disabled' });
  assert.deepEqual(s.calls, [FREE_ARGS]);
});

test('outro Claude Code aberto: não abre um segundo', async () => {
  const { s, refresher } = setup({ renewOn: 'paid', cliOpen: 1 });
  assert.deepEqual(await refresher.refresh({ allowPaid: true }), { ok: false, reason: 'cli-open' });
  assert.deepEqual(s.calls, [FREE_ARGS]);
});

test('sem CLI instalado', async () => {
  const { refresher } = setup({ exe: null });
  assert.deepEqual(await refresher.refresh(), { ok: false, reason: 'no-cli' });
});

test('após falha espera o cooldown; chamadas simultâneas compartilham a tentativa', async () => {
  const { s, refresher } = setup();
  const [a, b] = await Promise.all([refresher.refresh({ allowPaid: true }), refresher.refresh({ allowPaid: true })]);
  assert.equal(a, b);
  assert.equal(a.reason, 'not-renewed');
  assert.equal(s.calls.length, 2);
  assert.equal((await refresher.refresh({ allowPaid: true })).reason, 'cooldown');
  s.now += COOLDOWN_MS + 1;
  assert.equal((await refresher.refresh({ allowPaid: true })).reason, 'not-renewed');
  assert.equal(s.calls.length, 4);
});
