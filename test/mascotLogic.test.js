const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/main/mascotLogic');

const MIN = 60000;
const NOW = 1_800_000_000_000;
const ok = (session, weekly, extra = {}) => ({ state: 'ok', data: { session: { pct: session, resetsAt: NOW + 100 * MIN }, weekly: { pct: weekly, resetsAt: NOW + 3 * 1440 * MIN } }, forecast: { session: { status: 'safe' }, weekly: { status: 'safe' } }, ...extra });

test('emotion: uma por vez, na prioridade do plano', () => {
  assert.equal(m.emotion(ok(20, 30), NOW), 'feliz');
  assert.equal(m.emotion(ok(20, 51), NOW), 'cansado');
  assert.equal(m.emotion(ok(20, 80, { forecast: { session: { status: 'range' }, weekly: { status: 'safe' } } }), NOW), 'preocupado');
  assert.equal(m.emotion(ok(20, 80, { state: 'offline', forecast: { session: { status: 'range' } } }), NOW), 'confuso');
  assert.equal(m.emotion(ok(100, 80, { state: 'offline' }), NOW), 'morto');
  assert.equal(m.emotion(ok(40, 100), NOW), 'morto');
});

test('emotion: confuso sem dados, com token expirado e com limite de consultas longo', () => {
  assert.equal(m.emotion({ state: 'loading', data: null }, NOW), 'confuso');
  assert.equal(m.emotion(ok(10, 10, { state: 'auth' }), NOW), 'confuso');
  assert.equal(m.emotion(ok(10, 10, { state: 'ratelimit', nextAt: NOW + 5 * MIN }), NOW), 'confuso');
  assert.equal(m.emotion(ok(10, 10, { state: 'ratelimit', nextAt: NOW + MIN }), NOW), 'feliz'); // limite curto: segue normal
  assert.equal(m.emotion(ok(10, 10, { state: 'loading' }), NOW), 'feliz'); // atualizando com dado na mão
});

test('summary: texto do balão ao passar o mouse', () => {
  assert.equal(m.summary(ok(62, 37), NOW), 'Sessão 62%, reset em 1h40\nSemanal 37%, reset em 3d0h');
  assert.equal(m.summary({ data: { session: { pct: 5, resetsAt: null }, weekly: null } }, NOW), 'Sessão 5%');
  assert.equal(m.summary({ data: null }, NOW), 'Sem dados de uso');
});

test('nextWalkDelayMs: um trecho a cada 2 a 5 min no normal; raro e frequente ajustam', () => {
  assert.equal(m.nextWalkDelayMs('normal', 0), 2 * MIN);
  assert.ok(m.nextWalkDelayMs('normal', 0.999) <= 5 * MIN);
  assert.ok(m.nextWalkDelayMs('rare', 0) >= 5 * MIN);
  assert.ok(m.nextWalkDelayMs('often', 0.999) <= 2 * MIN);
  assert.equal(m.nextWalkDelayMs('??', 0), 2 * MIN);
});

test('planWalk: trecho curto para um dos lados', () => {
  assert.deepEqual(m.planWalk(0.1, 0), { dir: -1, distance: 90 });
  const p = m.planWalk(0.9, 0.999);
  assert.equal(p.dir, 1);
  assert.ok(p.distance <= 310);
});

// Dois monitores lado a lado; o da direita tem a barra de tarefas mais alta (chão 40 px acima).
const A = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const B = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1000 } };
const C = { id: 3, bounds: { x: 0, y: 1080, width: 1920, height: 1080 }, workArea: { x: 0, y: 1080, width: 1920, height: 1040 } }; // embaixo do A

test('neighbor e displayAt: só vale vizinho lateral', () => {
  assert.equal(m.neighbor([A, B, C], A, 1).id, 2);
  assert.equal(m.neighbor([A, B, C], A, -1), null);
  assert.equal(m.neighbor([A, B, C], B, -1).id, 1);
  assert.equal(m.neighbor([A, C], A, 1), null); // o de baixo não é vizinho
  assert.equal(m.displayAt([A, B], 2000, 500).id, 2);
  assert.equal(m.displayAt([A, B], -500, 500).id, 1); // fora de tudo: o mais próximo
  assert.equal(m.groundOf(A), 1040);
});

test('stepWalk: anda, termina o trecho e dá meia-volta sem vizinho', () => {
  const walk = m.stepWalk({ cx: 500, dir: 1, left: 100 }, 0.1, A, [A]);
  assert.equal(walk.type, 'walk');
  assert.ok(Math.abs(walk.cx - (500 + m.WALK_SPEED * 0.1)) < 1e-9);
  assert.equal(m.stepWalk({ cx: 500, dir: 1, left: 3 }, 0.1, A, [A]).type, 'done');
  const turn = m.stepWalk({ cx: 1920 - m.HALF_W - 1, dir: 1, left: 200 }, 0.1, A, [A]);
  assert.equal(turn.type, 'walk');
  assert.equal(turn.dir, -1);
  assert.equal(turn.cx, 1920 - m.HALF_W);
});

test('stepWalk: atravessa para o vizinho no mesmo nível, cai se for mais baixo e pula se for mais alto', () => {
  const B2 = { ...B, workArea: { ...B.workArea, height: 1040 } };
  assert.equal(m.stepWalk({ cx: 1919, dir: 1, left: 200 }, 0.1, A, [A, B2]).type, 'cross');
  // de B (chão 1000) para A (chão 1040): cai
  const fall = m.stepWalk({ cx: 1921, dir: -1, left: 200 }, 0.1, B, [A, B]);
  assert.equal(fall.type, 'fall');
  assert.equal(fall.to.id, 1);
  assert.ok(fall.vx < 0);
  // de A para B: pula antes da borda
  const jump = m.stepWalk({ cx: 1920 - m.HALF_W - 1, dir: 1, left: 200 }, 0.1, A, [A, B]);
  assert.equal(jump.type, 'jump');
  assert.ok(jump.vy < 0 && jump.vx > 0);
});

test('stepWalk: recém-chegado a um monitor, encostado na borda de trás, segue em frente', () => {
  // acabou de cair de B para A e continua para a esquerda, ainda dentro da margem da borda direita de A
  const r = m.stepWalk({ cx: 1919 - 5, dir: -1, left: 80 }, 0.1, A, [A, B]);
  assert.equal(r.type, 'walk');
  assert.equal(r.dir, -1);
  assert.ok(r.cx < 1914);
});

test('stepWalk: velocidade de corrida e parar na borda quando vai até o mouse', () => {
  const run = m.stepWalk({ cx: 500, dir: 1, left: 400, speed: m.RUN_SPEED }, 0.1, A, [A]);
  assert.ok(Math.abs(run.cx - 520) < 1e-9);
  const edge = m.stepWalk({ cx: 1920 - m.HALF_W - 1, dir: 1, left: 400, stopAtEdge: true }, 0.1, A, [A]);
  assert.equal(edge.type, 'done');
  assert.equal(edge.cx, 1920 - m.HALF_W);
});

test('planGoTo: direção e distância até o ponteiro; perto demais não anda', () => {
  assert.deepEqual(m.planGoTo(500, 900), { dir: 1, distance: 400 });
  assert.deepEqual(m.planGoTo(500, 100), { dir: -1, distance: 400 });
  assert.equal(m.planGoTo(500, 505), null);
});

test('shownEmotion: temporária > fixada > a que vem do uso', () => {
  assert.equal(m.shownEmotion('cansado', 'auto', null), 'cansado');
  assert.equal(m.shownEmotion('cansado', 'feliz', null), 'feliz');
  assert.equal(m.shownEmotion('cansado', 'feliz', 'confuso'), 'confuso');
  assert.equal(m.shownEmotion('cansado', 'qualquer', 'outra'), 'cansado');
});

test('stepAir: cai com gravidade, pousa só descendo, e o pulo alcança o chão mais alto', () => {
  let s = { cx: 100, foot: 500, vx: 0, vy: 0 };
  let t = 0;
  while (!s.landed && t < 5) { s = { vx: 0, ...m.stepAir(s, 1 / 60, 1040) }; t += 1 / 60; }
  assert.equal(s.foot, 1040);
  assert.ok(Math.abs(t - Math.sqrt((2 * 540) / m.GRAVITY)) < 0.05); // tempo de queda livre

  // pulo de A (1040) para B (1000): sobe acima de 1000 e pousa em 1000 já do outro lado
  let j = { cx: 1920 - m.HALF_W, foot: 1040, vx: 210, vy: m.jumpVelocity(40) };
  let top = j.foot;
  for (let i = 0; i < 600 && !j.landed; i++) {
    const ground = j.cx >= 1920 ? 1000 : 1040;
    j = { vx: 210, ...m.stepAir(j, 1 / 60, ground) };
    top = Math.min(top, j.foot);
  }
  assert.ok(top < 1000 - 20, `subiu até ${top}`);
  assert.equal(j.foot, 1000);
  assert.ok(j.cx > 1920 + m.HALF_W, 'pousou inteiro no outro monitor');
});

test('parseForeground e isFullscreen: tela cheia cobre o monitor; área de trabalho e janela maximizada não contam', () => {
  const rects = [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: 1920, y: 0, width: 2560, height: 1440 }];
  const fg = (text) => m.parseForeground(text);
  assert.deepEqual(fg('0,0,1920,1080,Chrome_WidgetWin_1\r\n'), { rect: { left: 0, top: 0, right: 1920, bottom: 1080 }, className: 'Chrome_WidgetWin_1' });
  assert.equal(m.isFullscreen(fg('0,0,1920,1080,Chrome_WidgetWin_1'), rects), true);
  assert.equal(m.isFullscreen(fg('1920,0,4480,1440,UnityWndClass'), rects), true);
  assert.equal(m.isFullscreen(fg('0,0,1920,1080,WorkerW'), rects), false);
  assert.equal(m.isFullscreen(fg('-8,-8,1928,1048,Notepad'), rects), false); // maximizada: não cobre a barra de tarefas
  assert.equal(m.isFullscreen(fg('100,100,900,700,Notepad'), rects), false);
  assert.equal(m.parseForeground('erro qualquer'), null);
  assert.equal(m.isFullscreen(null, rects), false);
});

test('balloonPosition: acima do mascote, abaixo se não couber, sempre dentro da tela', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const content = { width: 236, height: 430 };
  const win = { width: 308, height: 520 };
  // no chão, no meio: painel centralizado acima
  assert.deepEqual(m.balloonPosition({ x: 968, y: 980, width: 64, height: 60 }, content, win, area), { x: 1000 - 118 - 72, y: 980 - 430 - 10 });
  // no canto direito: encosta na margem
  assert.equal(m.balloonPosition({ x: 1850, y: 980, width: 64, height: 60 }, content, win, area).x, 1920 - 236 - 8 - 72);
  // no alto da tela: abre embaixo
  assert.equal(m.balloonPosition({ x: 500, y: 50, width: 64, height: 60 }, content, win, area).y, 120);
  // no canto esquerdo: o painel começa na margem
  assert.equal(m.balloonPosition({ x: 0, y: 980, width: 64, height: 60 }, content, win, area).x, 8 - 72);
});
