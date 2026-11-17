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

const FORCE_DEMO = process.argv.includes('--demo');
const INTERVALS = [30, 60, 120, 180, 300];
const SHORTCUT = 'Control+Alt+U';

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let store, widget, tray, pollTimer, backoffSec = 0;
let history, demoHistory; // pontos reais (arquivo) e pontos da demonstração (só memória)
let payload = { state: 'loading', data: null, fetchedAt: null, message: '', nextAt: null };
let fetching = false;
let lastRenewal = null; // resultado da última tentativa de renovar o token (aparece no menu)

const tokenRefresher = createTokenRefresher({ readExpiry, log: (r) => { lastRenewal = { ...r, at: Date.now() }; } });

const alerter = createAlerter((title, body) => {
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
});

function isDemo() {
  return FORCE_DEMO || store.get('demo');
}

function prefsPayload() {
  return { theme: store.get('theme') };
}

function activeHistory() {
  return isDemo() ? demoHistory : history;
}

// Previsão calculada sobre o último dado conhecido; a interface marca como desatualizada se ele envelhecer.
function withForecast(p) {
  p.forecast = forecastAll(p.data, activeHistory().all());
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
    const thresholds = [];
    if (store.get('alert80')) thresholds.push(80);
    if (store.get('alert90')) thresholds.push(90);
    alerter(data, thresholds, { forecast: store.get('alertForecast') ? payload.forecast : null, now: fetchedAt });
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
        { label: 'Avisar quando a previsão for menor que 15 min', type: 'checkbox', checked: store.get('alertForecast'), click: (i) => store.set('alertForecast', i.checked) },
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
    {
      label: 'Token e consumo',
      submenu: [
        { label: 'Renovar token automaticamente', type: 'checkbox', checked: store.get('autoRenew'), click: (i) => { store.set('autoRenew', i.checked); rebuildMenu(); } },
        { label: 'Permitir renovação com requisição mínima (gasta um pouco de uso)', type: 'checkbox', checked: store.get('autoRenewPaid'), enabled: store.get('autoRenew'), click: (i) => store.set('autoRenewPaid', i.checked) },
        { label: 'Plano B se o formato mudar (gasta um pouco de uso)', type: 'checkbox', checked: store.get('paidFallback'), click: (i) => store.set('paidFallback', i.checked) },
        { type: 'separator' },
        { label: renewalLabel(), enabled: false },
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
  watchCredentials();
  refresh();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (store) store.flush();
});
app.on('window-all-closed', (e) => e.preventDefault());
