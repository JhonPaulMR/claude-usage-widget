const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../src/main/displays');

const A = { id: 10, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const B = { id: 20, workArea: { x: 1920, y: -200, width: 2560, height: 1400 } }; // à direita e mais alto
const IDS = [10, 20];

test('migrate: monitor único e top absoluto viram preferência por monitor, com top relativo', () => {
  assert.deepEqual(d.migrate({ displayId: null, top: null }, [A, B], 10), { 10: { enabled: true, top: null } });
  assert.deepEqual(d.migrate({ displayId: 20, top: 100 }, [A, B], 10), { 20: { enabled: true, top: 300 } });
  // monitor salvo não existe mais: vai para o principal
  assert.deepEqual(d.migrate({ displayId: 99, top: 400 }, [A, B], 10), { 10: { enabled: true, top: 400 } });
  assert.equal(d.migrate({ displays: { 10: { enabled: true, top: 5 } } }, [A, B], 10), null);
});

test('resolveEnabled: marcados e ligados; sem nenhum, usa o principal', () => {
  const cfg = { 10: { enabled: false, top: null }, 20: { enabled: true, top: 50 } };
  assert.deepEqual(d.resolveEnabled(cfg, IDS, 10), [20]);
  assert.deepEqual(d.resolveEnabled({ 10: { enabled: true }, 20: { enabled: true } }, IDS, 10), [10, 20]);
  assert.deepEqual(d.resolveEnabled(cfg, [10], 10), [10]); // o 20 foi desligado do PC
  assert.deepEqual(d.resolveEnabled({}, IDS, 10), [10]);
  assert.deepEqual(d.resolveEnabled(null, [20], 10), [20]);
});

test('setEnabled: marca, desmarca e recusa deixar o widget sem monitor', () => {
  const one = { 10: { enabled: true, top: 120 } };
  const two = d.setEnabled(one, 20, true, IDS, 10);
  assert.deepEqual(two, { 10: { enabled: true, top: 120 }, 20: { enabled: true, top: null } });
  assert.deepEqual(d.setEnabled(two, 10, false, IDS, 10), { 10: { enabled: false, top: 120 }, 20: { enabled: true, top: null } });
  assert.equal(d.setEnabled(one, 10, false, IDS, 10), null);
  assert.equal(d.setEnabled(one, 99, true, IDS, 10), null); // monitor desconhecido
});

test('setEnabled: o principal usado como reserva vira marcação explícita', () => {
  // só o 20 estava marcado e foi desligado do PC; o widget está no 10 por reserva
  const cfg = { 20: { enabled: true, top: 50 } };
  assert.equal(d.setEnabled(cfg, 10, false, [10], 10), null);
  // o 20 volta: marcar o 20 de novo não tira o widget do 10
  const next = d.setEnabled({}, 20, true, IDS, 10);
  assert.deepEqual(d.resolveEnabled(next, IDS, 10), [10, 20]);
});

test('setTop e clearTops: posição por monitor', () => {
  const cfg = d.setTop({ 10: { enabled: true, top: null } }, 20, 77);
  assert.deepEqual(cfg, { 10: { enabled: true, top: null }, 20: { enabled: true, top: 77 } });
  assert.deepEqual(d.clearTops(cfg), { 10: { enabled: true, top: null }, 20: { enabled: true, top: null } });
});

test('bounds: borda direita de cada monitor, top relativo à área útil dele', () => {
  assert.deepEqual(d.bounds(A.workArea, 100, 308, 520, 240), { x: 1612, y: 100, width: 308, height: 520 });
  assert.deepEqual(d.bounds(B.workArea, 100, 308, 520, 240), { x: 1920 + 2560 - 308, y: -100, width: 308, height: 520 });
  assert.equal(d.bounds(A.workArea, null, 308, 520, 240).y, 260); // centralizado
  assert.equal(d.bounds(A.workArea, 5000, 308, 520, 240).y, 800); // a aba não sai por baixo
  assert.equal(d.bounds(B.workArea, -50, 308, 520, 240).y, -200); // nem por cima
});
