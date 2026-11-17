const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHistory, parseHistory, toRow, KEEP_MS } = require('../src/main/history');

const NOW = 1_800_000_000_000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cuw-hist-'));
const data = (s, w) => ({ session: { pct: s }, weekly: { pct: w } });

test('parseHistory: descarta linhas quebradas e pontos com mais de 30 dias, e ordena', () => {
  const text = [
    JSON.stringify([NOW - 1000, 12, 40]),
    '[123, 1',
    JSON.stringify([NOW - KEEP_MS - 1, 5, 5]),
    JSON.stringify({ t: 1 }),
    JSON.stringify([NOW - 5000, 11, 40]),
    '',
  ].join('\n');
  assert.deepEqual(parseHistory(text, NOW), [[NOW - 5000, 11, 40], [NOW - 1000, 12, 40]]);
  assert.deepEqual(parseHistory('', NOW), []);
});

test('toRow: porcentagem ausente vira null', () => {
  assert.deepEqual(toRow(5, { session: { pct: 3 }, weekly: null }), [5, 3, null]);
});

test('createHistory: grava um ponto por consulta e relê do arquivo', async () => {
  const dir = tmp();
  const h = createHistory(dir, { now: NOW });
  h.add(NOW, data(10, 50));
  h.add(NOW + 60000, data(11, 50));
  await new Promise((r) => setTimeout(r, 100));
  const again = createHistory(dir, { now: NOW + 120000 });
  assert.deepEqual(again.all(), [[NOW, 10, 50], [NOW + 60000, 11, 50]]);
});

test('createHistory: remove da memória o que passou de 30 dias', () => {
  const h = createHistory(tmp(), { persist: false });
  h.add(NOW, data(1, 1));
  h.add(NOW + KEEP_MS + 1, data(2, 2));
  assert.deepEqual(h.all(), [[NOW + KEEP_MS + 1, 2, 2]]);
});

test('createHistory: persist=false não cria arquivo; migra as amostras antigas do settings.json', () => {
  const dir = tmp();
  createHistory(dir, { persist: false }).add(NOW, data(1, 1));
  assert.equal(fs.existsSync(path.join(dir, 'history.jsonl')), false);
  const h = createHistory(dir, { seed: [{ t: NOW - 1000, s: 7, w: 30 }], now: NOW });
  assert.deepEqual(h.all(), [[NOW - 1000, 7, 30]]);
  assert.deepEqual(parseHistory(fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8'), NOW), [[NOW - 1000, 7, 30]]);
});
