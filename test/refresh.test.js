const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decayBackoffSec, nextBackoffSec, isStuck, isOverdue, STUCK_MS, OVERDUE_GRACE_MS } = require('../src/main/schedule');
const { request } = require('../src/main/usageProvider');
const { createDiagLog, formatLine } = require('../src/main/diagLog');

// ---------- ritmo depois de um 429 ----------

test('decayBackoff: depois de um 429 o ritmo volta ao intervalo aos poucos', () => {
  assert.equal(decayBackoffSec(0, 60), 0);
  assert.equal(decayBackoffSec(60, 60), 0);
  assert.equal(decayBackoffSec(300, 60), 200);
  assert.equal(decayBackoffSec(200, 60), 133);
  assert.equal(decayBackoffSec(133, 60), 88);
  assert.equal(decayBackoffSec(88, 60), 0); // 58 < 60: chegou no intervalo
});

test('decayBackoff: com 30 s não volta direto a 30 depois do primeiro 429', () => {
  const after429 = nextBackoffSec(0, 30); // 45
  assert.equal(after429, 45);
  assert.equal(decayBackoffSec(after429, 30), 0); // 30 = intervalo
  const after2 = nextBackoffSec(after429, 30); // 68
  assert.equal(decayBackoffSec(after2, 30), 45);
});

// ---------- consulta presa e timer atrasado ----------

test('isStuck: só depois do limite e só com consulta em andamento', () => {
  const t0 = 1_000_000;
  assert.equal(isStuck(null, t0), false);
  assert.equal(isStuck(t0, t0 + 1000), false);
  assert.equal(isStuck(t0, t0 + STUCK_MS + 1), true);
});

test('isOverdue: timer que devia ter disparado há mais que a folga', () => {
  const t0 = 1_000_000;
  assert.equal(isOverdue(null, t0), false);
  assert.equal(isOverdue(t0, t0 + 5000), false);
  assert.equal(isOverdue(t0, t0 + OVERDUE_GRACE_MS + 1), true);
});

// ---------- requisição ----------

function fakeResponse({ status = 200, body = '{}', bodyDelayMs = 0, signal } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    text: () => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(body), bodyDelayMs);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    }),
  };
}

test('request: lê o corpo e devolve status e texto', async () => {
  const fetchImpl = async (_url, init) => fakeResponse({ body: '{"a":1}', signal: init.signal });
  const r = await request('https://x', {}, { fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(r.ok, true);
  assert.equal(r.body, '{"a":1}');
});

test('request: o prazo cobre o corpo (corpo que nunca chega não pendura a consulta)', async () => {
  const fetchImpl = async (_url, init) => fakeResponse({ bodyDelayMs: 10_000, signal: init.signal });
  const t0 = Date.now();
  await assert.rejects(request('https://x', {}, { fetchImpl, timeoutMs: 50 }), (e) => {
    assert.equal(e.kind, 'network');
    assert.equal(e.detail, 'timeout');
    assert.match(e.message, /Sem resposta/);
    return true;
  });
  assert.ok(Date.now() - t0 < 2000);
});

test('request: falha de rede guarda o motivo real (cause.code)', async () => {
  const fetchImpl = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }) }); };
  await assert.rejects(request('https://x', {}, { fetchImpl }), (e) => e.kind === 'network' && e.detail === 'ECONNRESET');
});

test('request: erro do Chromium (net::ERR_...) também vira motivo', async () => {
  const fetchImpl = async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); };
  await assert.rejects(request('https://x', {}, { fetchImpl }), (e) => e.detail === 'net::ERR_INTERNET_DISCONNECTED');
});

// ---------- registro de diagnóstico ----------

test('formatLine: data, etiqueta, mensagem e extras sem vazios', () => {
  const t = new Date(2026, 10, 26, 13, 46, 5).getTime();
  assert.equal(formatLine(t, 'offline', 'Sem conexão', { detail: 'ECONNRESET', status: null }), '2026-11-26 13:46:05 [offline] Sem conexão detail=ECONNRESET');
});

test('diagLog: grava linhas e gira o arquivo ao passar do limite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuw-log-'));
  const log = createDiagLog(dir, { maxBytes: 200 });
  for (let i = 0; i < 10; i++) log.write('offline', `tentativa ${i}`);
  const cur = fs.readFileSync(path.join(dir, 'widget.log'), 'utf8');
  assert.ok(fs.existsSync(path.join(dir, 'widget.log.1')));
  assert.ok(cur.length <= 200);
  assert.match(cur, /tentativa 9/);
  fs.rmSync(dir, { recursive: true, force: true });
});
