// Janelas do widget: uma por monitor marcado, cada uma sem borda e colada na borda direita.
// Todas mostram os mesmos dados; abrir, recolher e arrastar é independente em cada uma.
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const rules = require('./displays');

// Janela de tamanho fixo (transparente). Expandir/recolher é só CSS; fora do widget ela é
// "click-through" (setIgnoreMouseEvents), então não bloqueia os apps embaixo.
const WIN_W = 308;
const WIN_H = 520; // cabe o painel com os gráficos, a previsão em duas linhas e os modelos
const TAB_MARGIN = 20;

// `--split-display` (desenvolvimento): divide o monitor principal em dois falsos, lado a lado,
// para conferir o multi-monitor num PC com uma tela só.
const FAKE_SPLIT = process.argv.includes('--split-display');
function listDisplays() {
  if (!FAKE_SPLIT) return { all: screen.getAllDisplays(), primaryId: screen.getPrimaryDisplay().id };
  const p = screen.getPrimaryDisplay();
  const half = Math.floor(p.workArea.width / 2);
  const part = (id, x, width) => ({ id, size: { width, height: p.size.height }, workArea: { ...p.workArea, x, width } });
  return { all: [part(1, p.workArea.x, half), part(2, p.workArea.x + half, p.workArea.width - half)], primaryId: 1 };
}

// opts.onChange(): chamado quando a lista de monitores ou as marcações mudam.
function createWidgetManager(store, opts = {}) {
  const wins = new Map(); // id do monitor -> { id, win, dragStartTop }
  let clampH = 220 + TAB_MARGIN; // a aba recolhida é menor que a janela; permite encostar embaixo

  const cfg = () => store.get('displays') || {};

  function create(id) {
    const win = new BrowserWindow({
      width: WIN_W,
      height: WIN_H,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setMenuBarVisibility(false);
    const entry = { id, win, dragStartTop: 0 };
    wins.set(id, entry);
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return;
      place(entry);
      if (store.get('visible')) win.showInactive();
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    return entry;
  }

  function place(entry) {
    const display = listDisplays().all.find((d) => d.id === entry.id);
    if (!display || entry.win.isDestroyed()) return;
    const saved = cfg()[entry.id];
    entry.win.setBounds(rules.bounds(display.workArea, saved ? saved.top : null, WIN_W, WIN_H, clampH));
  }

  function placeAll() {
    for (const entry of wins.values()) place(entry);
  }

  // Cria e fecha janelas para bater com os monitores ligados e marcados.
  function sync() {
    const { all, primaryId } = listDisplays();
    const ids = all.map((d) => d.id);
    if (!store.get('displays')) store.set('displays', rules.migrate({ displayId: store.get('displayId'), top: store.get('top') }, all, primaryId));
    const want = rules.resolveEnabled(cfg(), ids, primaryId);
    for (const [id, entry] of wins) {
      if (want.includes(id)) continue;
      wins.delete(id);
      if (!entry.win.isDestroyed()) entry.win.destroy();
    }
    for (const id of want) if (!wins.has(id)) create(id);
    placeAll();
    if (opts.onChange) opts.onChange();
  }

  screen.on('display-metrics-changed', sync);
  screen.on('display-added', sync);
  screen.on('display-removed', sync);

  const bySender = (wc) => [...wins.values()].find((e) => !e.win.isDestroyed() && e.win.webContents === wc);

  return {
    sync,
    first: () => wins.values().next().value || null,
    bySender,
    // Lista para a janela de configurações: todos os monitores ligados e se o widget está em cada um.
    list() {
      const { all, primaryId } = listDisplays();
      const on = rules.resolveEnabled(cfg(), all.map((d) => d.id), primaryId);
      return all.map((d, i) => ({
        id: d.id,
        label: `Monitor ${i + 1}${d.id === primaryId ? ' (principal)' : ''} · ${d.size.width}×${d.size.height}`,
        enabled: on.includes(d.id),
      }));
    },
    setEnabled(id, enabled) {
      const { all, primaryId } = listDisplays();
      const next = rules.setEnabled(cfg(), id, enabled, all.map((d) => d.id), primaryId);
      if (next) store.set('displays', next);
      sync(); // mesmo recusando, devolve o estado certo para a caixa de seleção
      return !!next;
    },
    broadcast(channel, payload) {
      for (const { win } of wins.values()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
    },
    setVisible(show) {
      for (const { win } of wins.values()) {
        if (win.isDestroyed()) continue;
        if (show) win.showInactive();
        else win.hide();
      }
    },
    setIgnoreMouse(wc, ignore) {
      const entry = bySender(wc);
      if (entry) entry.win.setIgnoreMouseEvents(!!ignore, { forward: true });
    },
    dragStart(wc) {
      const entry = bySender(wc);
      if (entry) entry.dragStartTop = entry.win.getBounds().y;
    },
    // Salva a posição relativa ao monitor daquela janela.
    dragMove(wc, deltaY) {
      const entry = bySender(wc);
      const display = entry && listDisplays().all.find((d) => d.id === entry.id);
      if (!display || !Number.isFinite(deltaY)) return;
      const top = rules.clampTop(entry.dragStartTop + deltaY, display.workArea, clampH);
      store.set('displays', rules.setTop(cfg(), entry.id, top - display.workArea.y));
      place(entry);
    },
    // A altura da aba muda com os itens do modo compacto; a aba inteira precisa caber na tela.
    setTabHeight(h) {
      if (!Number.isFinite(h) || h < 60 || h > WIN_H) return;
      clampH = Math.round(h) + TAB_MARGIN;
      placeAll();
    },
    resetPositions() {
      store.set('displays', rules.clearTops(cfg()));
      placeAll();
    },
  };
}

module.exports = { createWidgetManager };
