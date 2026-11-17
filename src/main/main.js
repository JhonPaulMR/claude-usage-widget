const { app, Tray, Menu, Notification, globalShortcut, powerMonitor, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./store');
const { createWidgetManager } = require('./window');
const { fetchUsage, fetchDemo, readExpiry, CRED_PATH } = require('./usageProvider');
const { nextBackoffSec, nextDelaySec } = require('./schedule');
const { createTokenRefresher } = require('./tokenRefresher');
const { createAlerter } = require('./alerts');
const { createHistory } = require('./history');
const { forecastAll } = require('./forecast');
const { buildCharts } = require('./chart');
const prefs = require('./prefs');
const { createSettingsWindow } = require('./settingsWindow');
const { createMascot } = require('./mascot');

const FORCE_DEMO = process.argv.includes('--demo');
const SHORTCUT = 'Control+Alt+U';

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let store, widgets, mascot, tray, settingsWin, pollTimer, backoffSec = 0;
let history, demoHistory; // pontos reais (arquivo) e pontos da demonstração (só memória)
let payload = { state: 'loading', data: null, fetchedAt: null, message: '', nextAt: null };
let fetching = false;
let lastRenewal = null; // resultado da última tentativa de renovar o token (aparece nas configurações)

const tokenRefresher = createTokenRefresher({ readExpiry, log: (r) => { lastRenewal = { ...r, at: Date.now() }; } });

// No modo mascote o alerta vira fala; a notificação do Windows continua, a menos que seja desligada.
const alerter = createAlerter((title, body) => {
  if (mascot) mascot.say(title);
  if (mascot && !store.get('mascotNotify')) return;
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
});

function isDemo() {
  return FORCE_DEMO || store.get('demo');
}

// O que a janela do widget precisa saber das preferências.
function prefsPayload() {
  return {
    theme: store.get('theme'),
    chartMode: store.get('chartMode'),
    chartRange: store.get('chartRange'),
    compact: {
      session: store.get('compactSession'),
      weekly: store.get('compactWeekly'),
      forecast: store.get('compactForecast'),
      reset: store.get('compactReset'),
      chart: store.get('compactChart'),
    },
  };
}

function pushPrefs() {
  if (widgets) widgets.broadcast('prefs', prefsPayload());
  if (mascot) mascot.toBalloon('prefs', prefsPayload());
}

// Liga ou desliga o modo mascote. Os modos são exclusivos: no mascote as abas clássicas somem.
function applyMode() {
  const on = store.get('mode') === 'mascot';
  widgets.setSuppressed(on);
  if (on && !mascot) {
    mascot = createMascot({
      store,
      getDisplays: () => widgets.enabledDisplays(),
      onMenu: (win) => buildMenu().popup({ window: win }),
    });
    mascot.update(payload);
  } else if (!on && mascot) {
    mascot.destroy();
    mascot = null;
  }
}

function activeHistory() {
  return isDemo() ? demoHistory : history;
}

// Previsão e gráficos calculados sobre o último dado conhecido; a interface marca a previsão como
// desatualizada se ele envelhecer.
function withForecast(p) {
  const rows = activeHistory().all();
  const now = Date.now();
  p.forecast = forecastAll(p.data, rows, now);
  p.charts = buildCharts(p.data, rows, now, { mode: store.get('chartMode'), rangeMs: prefs.CHART_RANGES[store.get('chartRange')] });
  p.intervalSec = store.get('intervalSec');
  return p;
}

function push() {
  if (widgets) widgets.broadcast('usage', payload);
  if (mascot) {
    mascot.toBalloon('usage', payload);
    mascot.update(payload);
  }
}

// Agenda a próxima consulta e registra quando ela será (a interface mostra a contagem).
function schedule() {
  clearTimeout(pollTimer);
  const delayMs = nextDelaySec(payload.state, store.get('intervalSec'), backoffSec) * 1000;
  payload.nextAt = Date.now() + delayMs;
  pollTimer = setTimeout(refresh, delayMs);
}

// Token vencido: pede ao Claude Code para renovar (escondido) e consulta de novo se der certo.
function renewToken() {
  if (!store.get('autoRenew') || isDemo()) return;
  tokenRefresher.refresh({ allowPaid: store.get('autoRenewPaid') }).then((r) => {
    rebuildMenu();
    if (r.ok) refresh();
  });
}

// O Claude Code regrava o arquivo de credenciais ao renovar: se estávamos sem sessão, consulta na hora.
function watchCredentials() {
  let debounce = null;
  try {
    fs.watch(path.dirname(CRED_PATH), (_ev, name) => {
      if (name !== path.basename(CRED_PATH) || payload.state !== 'auth') return;
      clearTimeout(debounce);
      debounce = setTimeout(refresh, 800);
    });
  } catch {
    /* pasta ainda não existe: o agendamento normal cobre */
  }
}

async function refresh() {
  if (fetching) return;
  fetching = true;
  clearTimeout(pollTimer);
  try {
    const data = isDemo() ? fetchDemo() : await fetchUsage({ allowPaidFallback: store.get('paidFallback') });
    backoffSec = 0;
    const fetchedAt = Date.now();
    activeHistory().add(fetchedAt, data);
    payload = withForecast({ state: 'ok', data, fetchedAt, message: '' });
    if (!isDemo()) store.set('last', { data, fetchedAt });
    alerter(data, prefs.alertThresholds(store.get), { forecast: store.get('alertForecast') ? payload.forecast : null, now: fetchedAt });
  } catch (e) {
    const kind = e.kind || 'network';
    if (kind === 'ratelimit') backoffSec = nextBackoffSec(backoffSec, store.get('intervalSec'), e.retryAfterSec);
    const last = store.get('last');
    payload = withForecast({
      state: kind === 'network' ? 'offline' : kind,
      data: last ? last.data : null,
      fetchedAt: last ? last.fetchedAt : null,
      message: e.message || '',
      renewing: false,
    });
    if (e.expired && store.get('autoRenew')) {
      payload.renewing = true;
      renewToken();
    }
  } finally {
    fetching = false;
    schedule();
    push();
    rebuildMenu();
  }
}

// Menu da bandeja e do botão direito: só o essencial. O resto está na janela de configurações.
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Atualizar agora', click: refresh },
    {
      label: store.get('visible') ? 'Ocultar widget' : 'Mostrar widget',
      accelerator: SHORTCUT,
      click: toggleVisible,
    },
    {
      label: 'Modo mascote',
      type: 'checkbox',
      checked: store.get('mode') === 'mascot',
      click: (i) => applyPref('mode', i.checked ? 'mascot' : 'classic'),
    },
    { label: 'Configurações…', click: openSettings },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ]);
}

function renewalLabel() {
  if (tokenRefresher.isRunning()) return 'Renovando token…';
  if (!lastRenewal) return 'Nenhuma renovação nesta execução';
  const when = new Date(lastRenewal.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (lastRenewal.ok) {
    const how = { free: 'sem custo', paid: 'requisição mínima', none: 'já estava válido' }[lastRenewal.tier] || '';
    return `Última renovação: ${when} (${how})`;
  }
  const why = {
    'no-cli': 'Claude Code não encontrado',
    'paid-disabled': 'requisição mínima desligada',
    'cli-open': 'aguardando o Claude Code aberto',
    'not-renewed': 'o Claude Code não renovou',
    cooldown: 'aguardando para tentar de novo',
  }[lastRenewal.reason] || 'erro';
  return `Renovação falhou às ${when}: ${why}`;
}

// Atualiza o que mostra estado fora do widget: menu da bandeja e janela de configurações.
function rebuildMenu() {
  if (tray) tray.setContextMenu(buildMenu());
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:state', settingsState());
}

function settingsState() {
  return {
    prefs: prefs.pick(store.get),
    displays: widgets.list(),
    renewal: renewalLabel(),
    forcedDemo: FORCE_DEMO,
    packaged: app.isPackaged,
    version: app.getVersion(),
    shortcut: 'Ctrl+Alt+U',
  };
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = createSettingsWindow(store.get('theme'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// Grava uma preferência vinda da janela de configurações e aplica o efeito dela.
function applyPref(key, value) {
  const r = prefs.sanitize(key, value);
  if (!r.ok) return;
  store.set(key, r.value);
  if (key === 'intervalSec') {
    backoffSec = 0;
    payload.intervalSec = r.value;
    schedule();
    push();
  } else if (key === 'chartMode' || key === 'chartRange') {
    payload = withForecast(payload);
    pushPrefs();
    push();
  } else if (key === 'theme' || key.startsWith('compact')) {
    pushPrefs();
    if (mascot) mascot.refreshPrefs();
  } else if (key === 'mode') {
    applyMode();
  } else if (key.startsWith('mascot')) {
    if (mascot) mascot.refreshPrefs();
  } else if (key === 'autostart') {
    applyAutostart();
  } else if (key === 'demo') {
    refresh();
  }
  rebuildMenu();
}

function applyAutostart() {
  if (!app.isPackaged) return; // em dev, registraria o electron.exe genérico
  app.setLoginItemSettings({ openAtLogin: !!store.get('autostart') });
}

function toggleVisible() {
  const show = !store.get('visible');
  store.set('visible', show);
  widgets.setVisible(show);
  if (mascot) mascot.setVisible(show);
  rebuildMenu();
}

app.on('second-instance', () => {
  if (!store.get('visible')) toggleVisible();
});

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'));
  for (const [k, v] of Object.entries(prefs.migrate(store.all()))) store.set(k, v);
  history = createHistory(app.getPath('userData'), { seed: store.get('history') || [] });
  demoHistory = createHistory(app.getPath('userData'), { persist: false });
  if (store.get('history')) store.set('history', undefined); // migrado para history.jsonl
  widgets = createWidgetManager(store, { onChange: () => { rebuildMenu(); if (mascot) mascot.onDisplaysChanged(); } });
  widgets.sync();
  applyMode();
  // Ganchos de desenvolvimento, para testes automatizados da interface.
  if (process.argv.includes('--dev-hooks')) global.__widget = { mascot: () => mascot, widgets, applyPref };

  const last = store.get('last');
  if (last && !isDemo()) payload = withForecast({ state: 'loading', data: last.data, fetchedAt: last.fetchedAt, message: '' });

  if (process.argv.includes('--perf')) {
    const perfWin = widgets.first().win;
    perfWin.webContents.once('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      console.log('PERF gpu', JSON.stringify(app.getGPUFeatureStatus()));
      console.log('PERF height', await perfWin.webContents.executeJavaScript('document.getElementById("widget").offsetHeight'));
      for (const nofx of [false, false, false, true, true, true]) console.log('PERF', nofx ? 'nofx' : 'fx  ', JSON.stringify(await perfWin.webContents.executeJavaScript(`__perf(${nofx})`)));
      app.quit();
    });
  }
  // Cada janela do widget avisa quando carregou e recebe o estado atual.
  ipcMain.on('ready', (e) => {
    if (!widgets.bySender(e.sender) && !(mascot && mascot.isBalloon(e.sender))) return;
    e.sender.send('prefs', prefsPayload());
    e.sender.send('usage', payload);
  });
  // A janela de configurações é a única que pode ler e gravar preferências.
  const fromSettings = (e) => settingsWin && !settingsWin.isDestroyed() && e.sender === settingsWin.webContents;
  ipcMain.handle('settings:get', (e) => (fromSettings(e) ? settingsState() : null));
  ipcMain.on('settings:set', (e, key, value) => { if (fromSettings(e)) applyPref(key, value); });
  ipcMain.on('settings:action', (e, name) => {
    if (!fromSettings(e)) return;
    if (name === 'center') widgets.resetPositions();
    if (name === 'refresh') refresh();
  });
  ipcMain.on('settings:display', (e, id, enabled) => { if (fromSettings(e)) widgets.setEnabled(id, !!enabled); });
  ipcMain.on('refresh', refresh);
  ipcMain.on('set-ignore', (e, ignore) => {
    if (mascot && mascot.isBalloon(e.sender)) mascot.setBalloonIgnore(ignore);
    else widgets.setIgnoreMouse(e.sender, ignore);
  });
  ipcMain.on('content-height', (e, h) => { if (mascot && mascot.isBalloon(e.sender)) mascot.setBalloonHeight(h); });
  ipcMain.on('balloon-hover', (e, inside) => { if (mascot && mascot.isBalloon(e.sender)) mascot.balloonHover(!!inside); });
  // Janela do mascote
  const fromMascot = (e) => mascot && mascot.isMascot(e.sender);
  ipcMain.on('mascot:ready', (e) => { if (fromMascot(e)) mascot.update(payload); });
  ipcMain.on('mascot:ignore', (e, ignore) => { if (fromMascot(e)) mascot.setIgnore(ignore); });
  ipcMain.on('mascot:drag-start', (e) => { if (fromMascot(e)) mascot.dragStart(); });
  ipcMain.on('mascot:drag-move', (e, dx, dy) => { if (fromMascot(e)) mascot.dragMove(dx, dy); });
  ipcMain.on('mascot:drag-end', (e) => { if (fromMascot(e)) mascot.dragEnd(); });
  ipcMain.on('mascot:click', (e) => { if (fromMascot(e)) mascot.click(); });
  ipcMain.on('mascot:menu', (e) => { if (fromMascot(e)) mascot.menu(); });
  ipcMain.on('drag-start', (e) => widgets.dragStart(e.sender));
  ipcMain.on('drag-move', (e, dy) => widgets.dragMove(e.sender, dy));
  ipcMain.on('tab-height', (e, h) => { if (widgets.bySender(e.sender)) widgets.setTabHeight(h); });
  ipcMain.on('context-menu', (e) => {
    const entry = widgets.bySender(e.sender);
    if (entry) buildMenu().popup({ window: entry.win });
    else if (mascot && mascot.isBalloon(e.sender)) buildMenu().popup();
  });

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
  if (process.argv.includes('--settings')) openSettings(); // atalho de desenvolvimento
  watchCredentials();
  refresh();
});

app.on('will-quit', () => {
  if (mascot) mascot.destroy(); // grava a posição
  globalShortcut.unregisterAll();
  if (store) store.flush();
});
app.on('window-all-closed', (e) => e.preventDefault());
