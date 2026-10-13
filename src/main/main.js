const { app, Tray, Menu, Notification, globalShortcut, powerMonitor, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const { createStore } = require('./store');
const { createWidgetWindow } = require('./window');
const { fetchUsage, fetchDemo } = require('./usageProvider');
const { createAlerter } = require('./alerts');

const FORCE_DEMO = process.argv.includes('--demo');
const INTERVALS = [30, 60, 120, 180, 300];
const SHORTCUT = 'Control+Alt+U';

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let store, widget, tray, pollTimer, backoffSec = 0;
let payload = { state: 'loading', data: null, fetchedAt: null, message: '' };
let fetching = false;

const alerter = createAlerter((title, body) => {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
});

function isDemo() {
  return FORCE_DEMO || store.get('demo');
}

function prefsPayload() {
  return { theme: store.get('theme') };
}

function push() {
  if (widget && !widget.win.isDestroyed()) widget.win.webContents.send('usage', payload);
}

function nextDelaySec() {
  if (payload.state === 'offline') return Math.min(store.get('intervalSec'), 15);
  if (payload.state === 'auth' || payload.state === 'format') return Math.max(store.get('intervalSec'), 60);
  return Math.max(store.get('intervalSec'), backoffSec);
}

function schedule() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(refresh, nextDelaySec() * 1000);
}

async function refresh() {
  if (fetching) return;
  fetching = true;
  clearTimeout(pollTimer);
  try {
    const data = isDemo() ? fetchDemo() : await fetchUsage();
    backoffSec = 0;
    const fetchedAt = Date.now();
    payload = { state: 'ok', data, fetchedAt, message: '' };
    store.set('last', { data, fetchedAt });
    const hist = store.get('history').concat({ t: fetchedAt, s: data.session && data.session.pct, w: data.weekly && data.weekly.pct });
    store.set('history', hist.slice(-60));
    const thresholds = [];
    if (store.get('alert80')) thresholds.push(80);
    if (store.get('alert90')) thresholds.push(90);
    if (thresholds.length) alerter(data, thresholds);
  } catch (e) {
    const kind = e.kind || 'network';
    if (kind === 'ratelimit') backoffSec = Math.min((backoffSec || store.get('intervalSec')) * 2, 600);
    const last = store.get('last');
    payload = {
      state: kind === 'network' ? 'offline' : kind === 'ratelimit' ? 'ok' : kind,
      data: last ? last.data : null,
      fetchedAt: last ? last.fetchedAt : null,
      message: e.message || '',
    };
    if (kind === 'ratelimit' && !last) payload.state = 'loading';
  } finally {
    fetching = false;
    push();
    schedule();
    rebuildMenu();
  }
}

function buildMenu() {
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  const currentId = store.get('displayId') ?? primaryId;
  return Menu.buildFromTemplate([
    { label: 'Atualizar agora', click: refresh },
    {
      label: 'Intervalo de atualização',
      submenu: INTERVALS.map((s) => ({
        label: s < 60 ? `${s} segundos` : `${s / 60} min`,
        type: 'radio',
        checked: store.get('intervalSec') === s,
        click: () => { store.set('intervalSec', s); backoffSec = 0; schedule(); },
      })),
    },
    { type: 'separator' },
    {
      label: store.get('visible') ? 'Ocultar widget' : 'Mostrar widget',
      accelerator: SHORTCUT,
      click: toggleVisible,
    },
    {
      label: 'Alertas',
      submenu: [
        { label: 'Avisar em 80%', type: 'checkbox', checked: store.get('alert80'), click: (i) => store.set('alert80', i.checked) },
        { label: 'Avisar em 90%', type: 'checkbox', checked: store.get('alert90'), click: (i) => store.set('alert90', i.checked) },
      ],
    },
    {
      label: 'Tema',
      submenu: ['dark', 'light'].map((t) => ({
        label: t === 'dark' ? 'Escuro' : 'Claro',
        type: 'radio',
        checked: store.get('theme') === t,
        click: () => { store.set('theme', t); widget.win.webContents.send('prefs', prefsPayload()); },
      })),
    },
    {
      label: 'Monitor',
      submenu: [
        ...displays.map((d, i) => ({
          label: `Monitor ${i + 1}${d.id === primaryId ? ' (principal)' : ''} — ${d.size.width}×${d.size.height}`,
          type: 'radio',
          checked: d.id === currentId,
          click: () => { store.set('displayId', d.id === primaryId ? null : d.id); widget.place(); },
        })),
        { type: 'separator' },
        { label: 'Centralizar verticalmente', click: () => widget.resetPosition() },
      ],
    },
    { type: 'separator' },
    {
      label: 'Iniciar com o Windows',
      type: 'checkbox',
      checked: store.get('autostart'),
      click: (i) => { store.set('autostart', i.checked); applyAutostart(); },
    },
    {
      label: 'Dados de demonstração',
      type: 'checkbox',
      checked: !!isDemo(),
      enabled: !FORCE_DEMO,
      click: (i) => { store.set('demo', i.checked); refresh(); },
    },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]);
}

function rebuildMenu() {
  if (tray) tray.setContextMenu(buildMenu());
}

function applyAutostart() {
  if (!app.isPackaged) return; // em dev, registraria o electron.exe genérico
  app.setLoginItemSettings({ openAtLogin: !!store.get('autostart') });
}

function toggleVisible() {
  const show = !store.get('visible');
  store.set('visible', show);
  if (show) widget.win.showInactive();
  else widget.win.hide();
  rebuildMenu();
}

app.on('second-instance', () => {
  if (!store.get('visible')) toggleVisible();
});

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'));
  widget = createWidgetWindow(store);
  widget.win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const last = store.get('last');
  if (last) payload = { state: 'loading', data: last.data, fetchedAt: last.fetchedAt, message: '' };

  if (process.argv.includes('--perf')) {
    widget.win.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      console.log('PERF gpu', JSON.stringify(app.getGPUFeatureStatus()));
      console.log('PERF height', await widget.win.webContents.executeJavaScript('document.getElementById("widget").offsetHeight'));
      for (const nofx of [false, false, false, true, true, true]) console.log('PERF', nofx ? 'nofx' : 'fx  ', JSON.stringify(await widget.win.webContents.executeJavaScript(`__perf(${nofx})`)));
      app.quit();
    });
  }
  widget.win.webContents.once('did-finish-load', () => {
    widget.place();
    if (store.get('visible')) widget.win.showInactive();
  });

  ipcMain.on('ready', () => {
    widget.win.webContents.send('prefs', prefsPayload());
    push();
  });
  ipcMain.on('refresh', refresh);
  ipcMain.on('set-ignore', (_e, ignore) => widget.setIgnoreMouse(ignore));
  ipcMain.on('drag-start', () => widget.dragStart());
  ipcMain.on('drag-move', (_e, dy) => widget.dragMove(dy));
  ipcMain.on('context-menu', () => buildMenu().popup({ window: widget.win }));

  const trayIcon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'build', 'tray.png'));
  tray = new Tray(trayIcon.isEmpty() ? nativeImage.createEmpty() : trayIcon);
  tray.setToolTip('Limites de uso do Claude');
  tray.on('click', toggleVisible);
  rebuildMenu();

  globalShortcut.register(SHORTCUT, toggleVisible);
  powerMonitor.on('resume', () => setTimeout(refresh, 3000));
  powerMonitor.on('unlock-screen', () => setTimeout(refresh, 2000));

  // Primeira execução da versão instalada: já inicia com o Windows (dá para desligar no menu).
  if (app.isPackaged && !store.get('autostartInit')) {
    store.set('autostartInit', true);
    store.set('autostart', true);
  }
  applyAutostart();
  refresh();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (store) store.flush();
});
app.on('window-all-closed', (e) => e.preventDefault());
