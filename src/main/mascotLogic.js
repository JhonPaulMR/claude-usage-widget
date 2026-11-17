// Regras puras do mascote (sem Electron): emoção, resumo, passeio, gravidade e troca de monitor.
// Posição do mascote = ponto dos pés: cx (centro, horizontal) e foot (base, vertical), em pixels de tela.

const MIN = 60000;
const GRAVITY = 2600; // px/s²
const WALK_SPEED = 70; // px/s
const RUN_SPEED = 200; // px/s quando é chamado até o mouse
const JUMP_SPEED_X = 210; // px/s ao pular para um chão mais alto
const JUMP_CLEARANCE = 36; // quanto o pulo passa acima do chão de destino
const HALF_W = 32; // meia largura do desenho (16 px x escala 4)
const LONG_RATELIMIT_MS = 2 * MIN;
const ADJ_TOLERANCE = 4;

// Uma emoção por vez, nesta prioridade: morto > confuso > preocupado > cansado > feliz.
// p: o payload enviado à interface ({ state, data, forecast, nextAt }).
function emotion(p, now = Date.now()) {
  const d = p && p.data;
  const pct = (x) => (x && typeof x.pct === 'number' ? x.pct : null);
  if (d && (pct(d.session) >= 100 || pct(d.weekly) >= 100)) return 'morto';
  const state = p && p.state;
  if (!d || ['offline', 'auth', 'format', 'server'].includes(state)) return 'confuso';
  if (state === 'ratelimit' && p.nextAt && p.nextAt - now > LONG_RATELIMIT_MS) return 'confuso';
  const fc = p.forecast || {};
  if ((fc.session && fc.session.status === 'range') || (fc.weekly && fc.weekly.status === 'range')) return 'preocupado';
  if (pct(d.weekly) > 50) return 'cansado';
  return 'feliz';
}

function countdown(ms) {
  const totalMin = Math.max(0, Math.ceil(ms / MIN));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}min`;
}

// Texto do balão ao passar o mouse: "Sessão 62%, reset em 1h40".
function summary(p, now = Date.now()) {
  const d = p && p.data;
  const part = (label, item) => {
    if (!item || typeof item.pct !== 'number') return null;
    const reset = item.resetsAt && item.resetsAt > now ? `, reset em ${countdown(item.resetsAt - now)}` : '';
    return `${label} ${Math.round(item.pct)}%${reset}`;
  };
  const lines = d ? [part('Sessão', d.session), part('Semanal', d.weekly)].filter(Boolean) : [];
  return lines.length ? lines.join('\n') : 'Sem dados de uso';
}

// Espera até o próximo trecho de passeio. freq: 'rare' | 'normal' | 'often'; rand em [0, 1).
const WALK_GAPS = { rare: [5 * MIN, 10 * MIN], normal: [2 * MIN, 5 * MIN], often: [30000, 2 * MIN] };
function nextWalkDelayMs(freq, rand = Math.random()) {
  const [lo, hi] = WALK_GAPS[freq] || WALK_GAPS.normal;
  return Math.round(lo + rand * (hi - lo));
}

// Trecho curto: direção e distância sorteadas. Devolve { dir, distance }.
function planWalk(randDir = Math.random(), randDist = Math.random()) {
  return { dir: randDir < 0.5 ? -1 : 1, distance: Math.round(90 + randDist * 220) };
}

// Monitores: [{ id, bounds: {x,y,width,height}, workArea: {...} }]. O chão é o topo da barra de tarefas.
const groundOf = (display) => display.workArea.y + display.workArea.height;

function displayAt(displays, x, y) {
  const inside = displays.find((d) => x >= d.bounds.x && x < d.bounds.x + d.bounds.width && y >= d.bounds.y && y < d.bounds.y + d.bounds.height);
  if (inside) return inside;
  let best = null, bestDist = Infinity;
  for (const d of displays) {
    const dx = Math.max(d.bounds.x - x, 0, x - (d.bounds.x + d.bounds.width));
    const dy = Math.max(d.bounds.y - y, 0, y - (d.bounds.y + d.bounds.height));
    if (dx * dx + dy * dy < bestDist) { bestDist = dx * dx + dy * dy; best = d; }
  }
  return best;
}

// Vizinho colado no lado para onde ele anda (dir -1 esquerda, +1 direita) e com alguma altura em comum.
function neighbor(displays, cur, dir) {
  const edge = dir > 0 ? cur.bounds.x + cur.bounds.width : cur.bounds.x;
  return displays.find((d) => {
    if (d.id === cur.id) return false;
    const touch = dir > 0 ? d.bounds.x : d.bounds.x + d.bounds.width;
    const overlap = Math.min(d.bounds.y + d.bounds.height, cur.bounds.y + cur.bounds.height) - Math.max(d.bounds.y, cur.bounds.y);
    return Math.abs(touch - edge) <= ADJ_TOLERANCE && overlap > 0;
  }) || null;
}

// Velocidade vertical inicial (negativa = para cima) para subir `rise` px e sobrar a folga do pulo.
function jumpVelocity(rise) {
  return -Math.sqrt(2 * GRAVITY * (Math.max(0, rise) + JUMP_CLEARANCE));
}

// Um passo no ar. Devolve { cx, foot, vy, landed }. Só pousa descendo.
function stepAir(s, dt, ground) {
  const vy = s.vy + GRAVITY * dt;
  const foot = s.foot + (s.vy + vy) / 2 * dt;
  const cx = s.cx + (s.vx || 0) * dt;
  if (vy >= 0 && foot >= ground) return { cx, foot: ground, vy: 0, landed: true };
  return { cx, foot, vy, landed: false };
}

// Um passo andando no chão. s: { cx, dir, left (px que faltam), speed?, stopAtEdge? }; cur: monitor atual.
// stopAtEdge: sem vizinho, para na borda em vez de dar meia-volta (indo até o mouse).
// Devolve o que aconteceu:
//   { type: 'walk', cx, left, dir }                 seguiu andando (dir muda ao dar meia-volta)
//   { type: 'done', cx }                            terminou o trecho
//   { type: 'cross', cx, to }                       passou para o vizinho no mesmo nível
//   { type: 'fall', cx, to, vx }                    o chão do vizinho é mais baixo: cai
//   { type: 'jump', cx, to, vx, vy }                o chão do vizinho é mais alto: pula
function stepWalk(s, dt, cur, displays) {
  const speed = s.speed || WALK_SPEED;
  const move = Math.min(speed * dt, s.left);
  let cx = s.cx + s.dir * move;
  const left = s.left - move;
  const minX = cur.bounds.x + HALF_W;
  const maxX = cur.bounds.x + cur.bounds.width - HALF_W;
  const next = neighbor(displays, cur, s.dir);
  // Só importa a borda para onde ele anda: logo depois de entrar num monitor ele ainda está
  // encostado na borda de trás, e isso não é motivo para dar meia-volta.
  const atEdge = s.dir > 0 ? cx > maxX : cx < minX;

  if (!next) {
    if (atEdge) {
      cx = Math.max(minX, Math.min(maxX, cx));
      return left > 0 && !s.stopAtEdge ? { type: 'walk', cx, left, dir: -s.dir } : { type: 'done', cx };
    }
    return left > 0 ? { type: 'walk', cx, left, dir: s.dir } : { type: 'done', cx };
  }

  const rise = groundOf(cur) - groundOf(next); // > 0: o vizinho é mais alto
  if (rise > 0 && atEdge) {
    return { type: 'jump', cx: Math.max(minX, Math.min(maxX, cx)), to: next, vx: s.dir * JUMP_SPEED_X, vy: jumpVelocity(rise) };
  }
  const crossed = s.dir > 0 ? cx >= cur.bounds.x + cur.bounds.width : cx < cur.bounds.x;
  if (crossed) {
    if (rise < 0) return { type: 'fall', cx, to: next, vx: s.dir * speed };
    return { type: 'cross', cx, to: next, left };
  }
  return left > 0 ? { type: 'walk', cx, left, dir: s.dir } : { type: 'done', cx };
}

// Ir andando até um ponto da tela (o ponteiro do mouse). Devolve { dir, distance } ou null se já está lá.
function planGoTo(cx, targetX, minDistance = 12) {
  const delta = targetX - cx;
  if (Math.abs(delta) < minDistance) return null;
  return { dir: delta < 0 ? -1 : 1, distance: Math.abs(delta) };
}

// Reação mostrada: a escolhida por um tempo, senão a fixada, senão a que vem do uso.
const EMOTES = ['neutro', 'feliz', 'cansado', 'preocupado', 'confuso', 'morto'];
function shownEmotion(real, fixed, temp) {
  if (EMOTES.includes(temp)) return temp;
  if (EMOTES.includes(fixed)) return fixed;
  return real;
}

// Saída do PowerShell "esq,topo,dir,base,classe" -> { rect, className } ou null.
function parseForeground(text) {
  const m = /^\s*(-?\d+),(-?\d+),(-?\d+),(-?\d+),(.*?)\s*$/.exec(String(text || ''));
  if (!m) return null;
  return { rect: { left: +m[1], top: +m[2], right: +m[3], bottom: +m[4] }, className: m[5] };
}

// A janela em primeiro plano cobre um monitor inteiro? (rects dos monitores em pixels físicos.)
// A área de trabalho também cobre a tela inteira, mas não conta como aplicativo em tela cheia.
const DESKTOP_CLASSES = ['Progman', 'WorkerW', 'Shell_TrayWnd', ''];
function isFullscreen(fg, displayRects) {
  if (!fg || DESKTOP_CLASSES.includes(fg.className)) return false;
  const r = fg.rect;
  return displayRects.some((d) => r.left <= d.x + 1 && r.top <= d.y + 1 && r.right >= d.x + d.width - 1 && r.bottom >= d.y + d.height - 1);
}

// Onde abrir o balão com o painel: acima do mascote, ou abaixo se não couber; sempre dentro da área útil.
// sprite: { x, y, width, height } na tela; content: tamanho do painel; win: tamanho da janela do painel
// (o painel fica encostado no canto superior direito dela). Devolve { x, y } da janela.
function balloonPosition(sprite, content, win, area, gap = 10) {
  const margin = 8;
  const centerX = sprite.x + sprite.width / 2;
  const left = Math.max(area.x + margin, Math.min(centerX - content.width / 2, area.x + area.width - content.width - margin));
  let top = sprite.y - content.height - gap;
  if (top < area.y + margin) top = sprite.y + sprite.height + gap;
  top = Math.min(top, area.y + area.height - content.height - margin);
  return { x: Math.round(left - (win.width - content.width)), y: Math.round(Math.max(area.y + margin, top)) };
}

module.exports = {
  GRAVITY, WALK_SPEED, RUN_SPEED, HALF_W, EMOTES,
  planGoTo, shownEmotion,
  emotion, summary, nextWalkDelayMs, planWalk,
  groundOf, displayAt, neighbor, jumpVelocity, stepAir, stepWalk,
  parseForeground, isFullscreen, balloonPosition,
};
