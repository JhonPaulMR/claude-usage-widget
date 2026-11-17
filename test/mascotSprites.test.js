const test = require('node:test');
const assert = require('node:assert/strict');
const { MASCOT_W, MASCOT_H, MASCOT_COLORS, MASCOT_POSES, mirrorFrame, blinkFrame } = require('../src/shared/mascotSprites');

const EXPECTED = ['neutro', 'feliz', 'cansado', 'preocupado', 'confuso', 'morto', 'andando', 'caindo', 'falando'];

test('todas as poses do plano existem', () => {
  assert.deepEqual(Object.keys(MASCOT_POSES).sort(), [...EXPECTED].sort());
});

test('todo quadro tem 16 x 15 e só usa caracteres da legenda', () => {
  const allowed = new Set(['.', ...Object.keys(MASCOT_COLORS)]);
  for (const [name, frames] of Object.entries(MASCOT_POSES)) {
    assert.ok(frames.length >= 1, name);
    frames.forEach((frame, i) => {
      assert.equal(frame.length, MASCOT_H, `${name}[${i}] linhas`);
      frame.forEach((row, y) => {
        assert.equal(row.length, MASCOT_W, `${name}[${i}] linha ${y}`);
        for (const ch of row) assert.ok(allowed.has(ch), `${name}[${i}] linha ${y}: "${ch}"`);
      });
    });
  }
});

test('poses animadas: andar tem quatro quadros, falar tem dois', () => {
  assert.equal(MASCOT_POSES.andando.length, 4);
  assert.equal(MASCOT_POSES.falando.length, 2);
  for (const name of ['andando', 'falando']) assert.notDeepEqual(MASCOT_POSES[name][0], MASCOT_POSES[name][1]);
});

test('o mascote não tem boca: pixel escuro só na altura dos olhos', () => {
  for (const [name, frames] of Object.entries(MASCOT_POSES)) {
    const eyeRows = name === 'morto' ? [10, 11, 12] : [5, 6, 7, 8, 9];
    frames.forEach((frame, i) => frame.forEach((row, y) => {
      if (row.includes('k')) assert.ok(eyeRows.includes(y), `${name}[${i}] linha ${y}`);
    }));
  }
});

test('só o morto é cinza; os outros têm corpo laranja e dois olhos', () => {
  for (const [name, frames] of Object.entries(MASCOT_POSES)) {
    const text = frames[0].join('');
    assert.equal(text.includes('g'), name === 'morto', name);
    assert.equal(text.includes('o'), name !== 'morto', name);
    assert.ok((text.match(/k/g) || []).length >= 4, `${name}: olhos`);
  }
});

test('blinkFrame: o olho fecha mas nunca some, em nenhuma pose', () => {
  const dark = (frame) => (frame.join('').match(/k/g) || []).length;
  for (const [name, frames] of Object.entries(MASCOT_POSES)) {
    frames.forEach((frame, i) => {
      const closed = blinkFrame(frame);
      assert.ok(dark(closed) >= 2, `${name}[${i}] ficou sem olhos`);
      assert.ok(dark(closed) <= dark(frame), `${name}[${i}]`);
      assert.equal(closed.length, MASCOT_H);
      closed.forEach((row) => assert.equal(row.length, MASCOT_W));
    });
  }
  // olho vertical de 2 px: sobra o pixel de baixo
  const neutro = blinkFrame(MASCOT_POSES.neutro[0]);
  assert.equal(neutro[7], '..oooooooooooo..');
  assert.equal(neutro[8], '..ookooooookoo..');
});

test('mirrorFrame espelha e é o próprio inverso', () => {
  const frame = MASCOT_POSES.andando[0];
  const flipped = mirrorFrame(frame);
  assert.equal(frame[7], '..oookooooooko..');
  assert.equal(flipped[7], '..okooooookooo..');
  assert.notDeepEqual(flipped, frame);
  assert.deepEqual(mirrorFrame(flipped), frame);
});
