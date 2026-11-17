/* global fmt, widget */
const R = 22;
const CIRC = 2 * Math.PI * R;

const $ = (id) => document.getElementById(id);
const els = {
  widget: $('widget'), tab: $('tab'), inner: $('panelInner'), status: $('status'), updated: $('updated'), refresh: $('refreshBtn'),
  models: $('models'),
};

let usage = { state: 'loading', data: null, fetchedAt: null, message: '', nextAt: null };
let open = false;
let pinned = false;
let leaveTimer = null;

// ---------- medidores (aba recolhida) ----------
const GAUGES = {
  session: { label: '5h usage', title: 'Sessão · 5 horas' },
  weekly: { label: 'Week usage', title: 'Semanal · 7 dias' },
};
for (const name of ['session', 'weekly']) {
  $(`gauge-${name}`).innerHTML =
    `<span class="gauge-label">${GAUGES[name].label}</span>` +
    `<div class="ring"><svg viewBox="0 0 52 52">` +
    `<circle class="ring-track" cx="26" cy="26" r="${R}"/>` +
    `<circle class="ring-fill c-unknown" cx="26" cy="26" r="${R}" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/>` +
    `<g transform="translate(15.5 15.5) scale(.875)"><path class="ring-logo" d="${window.CLAUDE_LOGO_PATH}"/></g>` +
    `</svg></div><span class="gauge-pct">—</span>`;
}

function setRing(name, item, stale) {
  const wrap = $(`gauge-${name}`);
  const ring = wrap.querySelector('.ring');
  const fill = wrap.querySelector('.ring-fill');
  const pct = item ? fmt.clampPct(item.pct) : null;
  const band = fmt.colorBand(pct);
  fill.setAttribute('stroke-dashoffset', String(CIRC * (1 - (pct == null ? 0 : pct / 100))));
  fill.setAttribute('class', `ring-fill c-${band}`);
  ring.className = `ring${!stale && band !== 'unknown' ? ` glow-${band}` : ''}${!stale && pct != null && pct > 90 ? ' pulse' : ''}`;
  wrap.querySelector('.gauge-pct').textContent = pct == null ? '—' : `${Math.round(pct)}%`;
}

// ---------- painel ----------
const TITLES = { session: GAUGES.session.title, weekly: GAUGES.weekly.title };
const WINDOWS = { session: fmt.SESSION_WINDOW_MS, weekly: fmt.WEEK_WINDOW_MS };

function cardHtml(name, item, now) {
  const pct = item ? fmt.clampPct(item.pct) : null;
  const band = fmt.colorBand(pct);
  const pace = item ? fmt.paceProjection(pct, item.resetsAt, WINDOWS[name], now) : { level: 'none', text: '' };
  const countdown = item && item.resetsAt ? fmt.formatCountdown(item.resetsAt - now) : '—';
  const at = item && item.resetsAt ? fmt.formatResetAt(item.resetsAt, now) : '—';
  return `
    <div class="row"><span class="title">${TITLES[name]}</span>
      <span class="pct t-${band}">${pct == null ? '—' : Math.round(pct) + '<small>%</small>'}</span></div>
    <div class="bar"><i class="b-${band}" data-w="${pct == null ? 0 : pct}"></i></div>
    <div class="sub">reseta em <b data-cd="${item && item.resetsAt || ''}">${countdown}</b> · ${at}</div>
    <div class="sub pace ${pace.level}">${pace.text}</div>`;
}

function render() {
  const now = Date.now();
  const d = usage.data;
  const stale = usage.state === 'offline' || usage.state === 'server' || usage.state === 'auth' || usage.state === 'format' || (usage.state === 'loading' && !d);
  els.widget.classList.toggle('stale', stale);

  setRing('session', d && d.session, stale);
  setRing('weekly', d && d.weekly, stale);

  $('card-session').innerHTML = cardHtml('session', d && d.session, now);
  $('card-weekly').innerHTML = cardHtml('weekly', d && d.weekly, now);
  // A política de segurança da página bloqueia style="" no HTML; a largura entra por JavaScript.
  document.querySelectorAll('.bar > i').forEach((el) => { el.style.width = `${el.dataset.w}%`; });
  els.models.innerHTML = ((d && d.models) || [])
    .map((m) => `<div class="model"><span>${m.label} (semanal)</span><b>${Math.round(m.pct)}%</b></div>`)
    .join('');

  const soft = usage.state === 'offline' || usage.state === 'loading' || usage.state === 'ratelimit' || usage.state === 'server';
  els.updated.textContent = usage.state === 'auth'
    ? (usage.renewing ? 'Pedindo ao Claude Code para renovar o token' : usage.message || '')
    : `Atualizado às ${fmt.formatClock(usage.fetchedAt)}`;
  els.status.className = `head-status ${usage.state === 'ok' ? '' : soft ? 'off' : 'err'}`;
  els.status.title = usage.message;
  renderStatus(now);
  syncHeight();
}

// Texto do estado. Fora do "ao vivo", mostra quanto falta para a próxima tentativa.
function renderStatus(now) {
  const d = usage.data;
  const wait = usage.nextAt && usage.nextAt > now ? ` · ${fmt.formatMmSs(usage.nextAt - now)}` : '';
  const msgs = {
    ok: 'ao vivo',
    loading: d ? 'atualizando' : 'carregando',
    offline: `sem conexão${wait}`,
    server: `servidor fora${wait}`,
    ratelimit: `limitado${wait}`,
    auth: usage.renewing ? 'renovando token' : 'sessão expirada',
    format: 'formato inesperado',
  };
  const text = msgs[usage.state] || '';
  if (els.status.textContent !== text) els.status.textContent = text;
}

// countdown local, a cada segundo, sem rede
function tick() {
  if (moving) return;
  const now = Date.now();
  document.querySelectorAll('[data-cd]').forEach((el) => {
    const t = Number(el.dataset.cd);
    if (t) el.textContent = fmt.formatCountdown(t - now);
  });
  renderStatus(now);
}
setInterval(tick, 1000);
// recalcula ritmo/horários a cada 30 s
setInterval(() => usage.data && renderSoon(), 30000);

// Durante a animação de abrir/recolher nada escreve no DOM: o relógio pula a vez e o render espera.
const MOVE_MS = 480;
let moving = false;
let moveTimer = null;
let renderPending = false;
function renderSoon() {
  if (moving) renderPending = true;
  else render();
}
function setOpen(v) {
  if (v === open) return;
  open = v;
  moving = true;
  els.widget.classList.add('moving');
  els.widget.classList.toggle('open', v);
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => {
    moving = false;
    els.widget.classList.remove('moving');
    if (renderPending) { renderPending = false; render(); } else tick();
  }, MOVE_MS);
}

// ---------- expandir / recolher ----------
// Janela fixa e transparente; fora do widget ela ignora o mouse (click-through) mas continua
// recebendo mousemove para detectar o hover.
const TAB_W = 72, TAB_H = 220;
let ignoring = true;
let fullW = 0, fullH = 0; // medidas guardadas: o mousemove não lê layout
function setIgnore(v) {
  if (v === ignoring) return;
  ignoring = v;
  window.widget.setIgnore(v);
}
function syncHeight() {
  fullW = els.widget.offsetWidth;
  fullH = els.widget.offsetHeight;
  els.widget.style.setProperty('--cb', `${Math.max(0, fullH - TAB_H)}px`);
}
function expand() {
  clearTimeout(leaveTimer);
  setOpen(true);
}
function collapse() {
  if (!open || pinned || dragging) return;
  setOpen(false);
}
function hit(x, y) {
  if (open) return x >= window.innerWidth - fullW && y <= fullH;
  return x >= window.innerWidth - TAB_W && y <= TAB_H;
}
function onPointer(x, y) {
  const inside = hit(x, y);
  setIgnore(!inside && !dragging);
  if (inside) expand();
  else if (open && !pinned) {
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(collapse, 350);
  }
}
window.addEventListener('mousemove', (e) => onPointer(e.clientX, e.clientY));
document.addEventListener('mouseleave', () => {
  if (dragging) return;
  setIgnore(true);
  if (open && !pinned) { clearTimeout(leaveTimer); leaveTimer = setTimeout(collapse, 350); }
});

// ---------- arrastar (vertical) e clicar para fixar ----------
let dragging = false;
let downY = null;
els.tab.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  downY = e.screenY;
  dragging = false;
});
window.addEventListener('mousemove', (e) => {
  if (downY == null) return;
  const dy = e.screenY - downY;
  if (!dragging && Math.abs(dy) > 4) {
    dragging = true;
    window.widget.dragStart();
  }
  if (dragging) window.widget.dragMove(dy);
});
window.addEventListener('mouseup', () => {
  if (downY == null) return;
  const wasDrag = dragging;
  downY = null;
  dragging = false;
  if (!wasDrag) {
    pinned = !pinned;
    els.widget.classList.toggle('pinned', pinned);
    if (pinned) expand();
  }
});
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.widget.contextMenu();
});

els.refresh.addEventListener('click', () => {
  els.refresh.classList.add('spin');
  window.widget.refresh();
  setTimeout(() => els.refresh.classList.remove('spin'), 1200);
});

// ---------- IPC ----------
window.widget.onUsage((p) => { usage = p; renderSoon(); });
window.widget.onPrefs((p) => { document.body.dataset.theme = p.theme || 'dark'; });
render();
syncHeight();
requestAnimationFrame(() => requestAnimationFrame(() => els.widget.classList.remove('init')));
window.widget.ready();

// Diagnóstico: mede o tempo entre frames durante expandir/recolher (usado por `electron . --perf`).
window.__perf = (nofx) => new Promise((resolve) => {
  document.body.classList.toggle('nofx', !!nofx);
  usage = { ...usage, data: { ...usage.data, session: { ...usage.data.session, pct: 95 } } };
  render();
  const run = (toOpen) => new Promise((done) => {
    const deltas = [];
    let last = performance.now();
    const end = last + 900;
    setOpen(toOpen);
    (function loop(t) {
      deltas.push(t - last); last = t;
      if (t < end) requestAnimationFrame(loop); else done(deltas);
    })(last);
  });
  run(true).then((a) => run(false).then((b) => {
    const all = a.concat(b).slice(1);
    const avg = all.reduce((x, y) => x + y, 0) / all.length;
    resolve({ frames: all.length, avgMs: +avg.toFixed(1), maxMs: +Math.max(...all).toFixed(1), over20ms: all.filter((d) => d > 20).length });
  }));
});
