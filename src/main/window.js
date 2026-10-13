// Janela sem borda, colada na borda direita; cresce para a esquerda ao expandir.
const { BrowserWindow, screen } = require('electron');
const path = require('path');

// Janela de tamanho fixo (transparente). Expandir/recolher é só CSS; fora do widget ela é
// "click-through" (setIgnoreMouseEvents), então não bloqueia os apps embaixo.
const WIN_W = 308;
const WIN_H = 380;
const WIN_CLAMP_H = 240; // o widget visível é menor que a janela; permite encostar embaixo

function createWidgetWindow(store) {
  let dragStartTop = 0;

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

  function targetDisplay() {
    const id = store.get('displayId');
    const all = screen.getAllDisplays();
    return all.find((d) => d.id === id) || screen.getPrimaryDisplay();
  }

  function clampTop(top, area, h) {
    return Math.round(Math.max(area.y, Math.min(top, area.y + area.height - h)));
  }

  function place() {
    const area = targetDisplay().workArea;
    const saved = store.get('top');
    const top = saved == null ? area.y + (area.height - WIN_H) / 2 : saved;
    win.setBounds({
      x: area.x + area.width - WIN_W,
      y: clampTop(top, area, WIN_CLAMP_H),
      width: WIN_W,
      height: WIN_H,
    });
  }

  screen.on('display-metrics-changed', place);
  screen.on('display-added', place);
  screen.on('display-removed', place);

  return {
    win,
    place,
    setIgnoreMouse(ignore) {
      win.setIgnoreMouseEvents(!!ignore, { forward: true });
    },
    dragStart() {
      dragStartTop = win.getBounds().y;
    },
    dragMove(deltaY) {
      const area = targetDisplay().workArea;
      const top = clampTop(dragStartTop + deltaY, area, WIN_CLAMP_H);
      store.set('top', top);
      place();
    },
    resetPosition() {
      store.set('top', null);
      place();
    },
  };
}

module.exports = { createWidgetWindow };
