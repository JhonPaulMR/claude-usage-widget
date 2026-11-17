const { app, Tray, Menu, Notification, globalShortcut, powerMonitor, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore } = require('./store');
const { createWidgetWindow } = require('./window');
const { fetchUsage, fetchDemo, readExpiry, CRED_PATH } = require('./usageProvider');
const { nextBackoffSec, nextDelaySec } = require('./schedule');
const { createTokenRefresher } = require('./tokenRefresher');
const { createAlerter } = require('./alerts');
const { createHistory } = require('./history');
const { forecastAll } = require('./forecast');
const { buildCharts } = require('./chart');
const prefs = require('./prefs');
const { createSettingsWindow } = require('./settingsWindow');

const FORCE_DEMO = process.argv.includes('--demo');
const SHORTCUT = 'Control+Alt+U';

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let store, widget, tray, settingsWin, pollTimer, backoffSec = 0;
let history, demoHistory; // pontos reais (arquivo) e pontos da demonstração (só memória)
let payload = { state: 'loading', data: null, fetchedAt: null, message: '', nextAt: null };
let fetching = false;
let lastRenewal = null; // resultado da última tentativa de renovar o token (aparece nas configurações)

const tokenRefresher = createTokenRefresher({ readExpiry, log: (r) => { lastRenewal = { ...r, at: Date.now() }; } });

const alerter = createAlerter((title, body) => {
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
  if (widget && !widget.win.isDestroyed()) widget.win.webContents.send('prefs', prefsPayload());
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
  if (widget && !widget.win.isDestroyed()) widget.win.webContents.send('usage', payload);
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
  const primaryId = screen.getPrimaryDisplay().id;
  return {
    prefs: prefs.pick(store.get),
    displays: screen.getAllDisplays().map((d, i) => ({
      id: d.id === primaryId ? null : d.id,
      label: `Monitor ${i + 1}${d.id === primaryId ? ' (principal)' : ''} · ${d.size.width}×${d.size.height}`,
    })),
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
  } else if (key === 'autostart') {
    applyAutostart();
  } else if (key === 'demo') {
    refresh();
  } else if (key === 'displayId') {
    widget.place();
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
  if (show) widget.win.showInactive();
  else widget.win.hide();
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
  widget = createWidgetWindow(store);
  widget.win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const last = store.get('last');
  if (last && !isDemo()) payload = withForecast({ state: 'loading', data: last.data, fetchedAt: last.fetchedAt, message: '' });

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
    pushPrefs();
    push();
  });
  // A janela de configurações é a única que pode ler e gravar preferências.
  const fromSettings = (e) => settingsWin && !settingsWin.isDestroyed() && e.sender === settingsWin.webContents;
  ipcMain.handle('settings:get', (e) => (fromSettings(e) ? settingsState() : null));
  ipcMain.on('settings:set', (e, key, value) => { if (fromSettings(e)) applyPref(key, value); });
  ipcMain.on('settings:action', (e, name) => {
    if (!fromSettings(e)) return;
    if (name === 'center') widget.resetPosition();
    if (name === 'refresh') refresh();
  });
  for (const ev of ['display-added', 'display-removed']) screen.on(ev, rebuildMenu);
  ipcMain.on('refresh', refresh);
  ipcMain.on('set-ignore', (_e, ignore) => widget.setIgnoreMouse(ignore));
  ipcMain.on('drag-start', () => widget.dragStart());
  ipcMain.on('drag-move', (_e, dy) => widget.dragMove(dy));
  ipcMain.on('tab-height', (_e, h) => widget.setTabHeight(h));
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
  if (process.argv.includes('--settings')) openSettings(); // atalho de desenvolvimento
  watchCredentials();
  refresh();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (store) store.flush();
});
app.on('window-all-closed', (e) => e.preventDefault());
