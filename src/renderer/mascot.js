/* global mascot, mascotBridge */
// Janela do mascote. O processo principal decide onde ele está e o que está fazendo (parado,
// andando, no ar, sendo arrastado, falando); aqui só se desenha a pose e se anima o corpo.
const POSES = window.mascot.MASCOT_POSES;
const COLORS = window.mascot.MASCOT_COLORS;
const flip = window.mascot.mirrorFrame;
const closeEyes = window.mascot.blinkFrame;

const actor = document.getElementById('actor');
const squash = document.getElementById('squash');
const bubble = document.getElementById('bubble');
const ctx = document.getElementById('sprite').getContext('2d');

let state = { pose: 'idle', fast: false, dir: 1, emotion: 'feliz', speech: null, summary: '', room: null, theme: 'dark' };
let frameIndex = 0;
let frameTimer = null;
let blinking = false;
let hovering = false;
let hoverTimer = null;

const FRAME_MS = { andando: 120, 'andando-rapido': 70, falando: 240 };
const BLINKERS = ['neutro', 'andando', 'falando', 'preocupado', 'confuso'];

// Qual desenho e qual animação usar agora.
function look() {
  if (state.emotion === 'morto') return { sprite: 'morto', anim: state.pose === 'drag' ? 'a-drag' : 'a-morto' };
  if (state.pose === 'drag') return { sprite: 'caindo', anim: 'a-drag' };
  if (state.pose === 'air') return { sprite: 'caindo', anim: 'a-air' };
  if (state.pose === 'walk') return { sprite: 'andando', anim: state.fast ? 'a-run' : 'a-walk', pace: state.fast ? 'andando-rapido' : 'andando' };
  if (state.pose === 'talk') return { sprite: 'falando', anim: 'a-talk' };
  return { sprite: state.emotion, anim: `a-${state.emotion}` };
}

function draw() {
  const { sprite } = look();
  const frames = POSES[sprite] || POSES.neutro;
  let frame = frames[frameIndex % frames.length];
  if (blinking) frame = closeEyes(frame); // piscar: o olho fecha, sem sumir
  if (state.dir < 0) frame = flip(frame);
  ctx.clearRect(0, 0, 16, 15);
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      ctx.fillStyle = ch === 'w' && state.theme === 'light' ? COLORS.k : COLORS[ch];
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

function playOnce(cls) {
  squash.classList.remove('fx-land', 'fx-pop');
  void squash.offsetWidth; // reinicia a animação
  squash.classList.add(cls);
}
squash.addEventListener('animationend', () => squash.classList.remove('fx-land', 'fx-pop'));

function apply(next) {
  const prev = state;
  const before = look();
  state = { ...state, ...next };
  const now = look();
  document.body.dataset.theme = state.theme || 'dark';

  if (now.anim !== before.anim || !actor.classList.contains(now.anim)) actor.className = `actor ${now.anim}`;
  const pace = (l) => l.pace || l.sprite;
  if (pace(now) !== pace(before)) {
    if (now.sprite !== before.sprite) frameIndex = 0;
    clearInterval(frameTimer);
    frameTimer = null;
    if (FRAME_MS[pace(now)]) frameTimer = setInterval(() => { frameIndex++; draw(); }, FRAME_MS[pace(now)]);
  }
  if (prev.pose === 'air' && state.pose !== 'air' && state.pose !== 'drag') playOnce('fx-land');
  else if (prev.emotion !== state.emotion && state.pose === 'idle') playOnce('fx-pop');
  draw();
  showBubble();
}

// Piscar de vez em quando, só nas poses de olho aberto.
(function blinkLoop() {
  setTimeout(() => {
    if (BLINKERS.includes(look().sprite)) {
      blinking = true;
      draw();
      setTimeout(() => { blinking = false; draw(); }, 130);
    }
    blinkLoop();
  }, 2600 + Math.random() * 3200);
})();

// A fala (alerta) tem prioridade; passando o mouse aparece o resumo.
function showBubble() {
  const text = state.speech || (hovering && state.pose !== 'drag' ? state.summary : '');
  bubble.classList.toggle('speech', !!state.speech);
  if (text) bubble.textContent = text; // ao esconder mantém o texto até a transição acabar
  bubble.style.setProperty('--shift', `${bubbleShift()}px`);
  bubble.classList.toggle('show', !!text);
}

// Perto da borda do monitor o balão desliza para o lado para não ser cortado.
function bubbleShift() {
  const room = state.room;
  if (!room) return 0;
  const half = bubble.offsetWidth / 2;
  const margin = 6;
  let shift = 0;
  if (half > room.left - margin) shift = half - (room.left - margin);
  else if (half > room.right - margin) shift = -(half - (room.right - margin));
  const max = Math.max(0, window.innerWidth / 2 - half);
  return Math.round(Math.max(-max, Math.min(max, shift)));
}

// ---------- mouse: a janela ignora cliques fora do desenho ----------
let ignoring = true;
function setIgnore(v) {
  if (v === ignoring) return;
  ignoring = v;
  mascotBridge.setIgnore(v);
}
function overSprite(x, y) {
  const left = window.innerWidth / 2 - 32;
  return x >= left && x <= left + 64 && y >= window.innerHeight - 60;
}

let down = null; // { x, y } em coordenadas de tela
let dragging = false;
window.addEventListener('mousemove', (e) => {
  if (down) {
    const dx = e.screenX - down.x;
    const dy = e.screenY - down.y;
    if (!dragging && Math.hypot(dx, dy) > 4) {
      dragging = true;
      mascotBridge.dragStart();
    }
    if (dragging) mascotBridge.dragMove(dx, dy);
    return;
  }
  const inside = overSprite(e.clientX, e.clientY);
  setIgnore(!inside);
  if (inside === hovering) return;
  hovering = inside;
  clearTimeout(hoverTimer);
  if (inside) hoverTimer = setTimeout(showBubble, 350);
  else showBubble();
});
document.addEventListener('mouseleave', () => {
  if (down) return;
  hovering = false;
  clearTimeout(hoverTimer);
  setIgnore(true);
  showBubble();
});
actor.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  down = { x: e.screenX, y: e.screenY };
  dragging = false;
});
window.addEventListener('mouseup', () => {
  if (!down) return;
  const wasDrag = dragging;
  down = null;
  dragging = false;
  if (wasDrag) mascotBridge.dragEnd();
  else mascotBridge.click();
});
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  mascotBridge.menu();
});

mascotBridge.onState(apply);
apply({});
mascotBridge.ready();
