// Janela de configurações: janela comum (com borda e na barra de tarefas), uma só por vez.
const { BrowserWindow } = require('electron');
const path = require('path');

function createSettingsWindow(theme) {
  const win = new BrowserWindow({
    width: 480,
    height: 700,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Configurações · Claude Usage Widget',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    backgroundColor: theme === 'light' ? '#f6f5f1' : '#111113',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'settingsPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  win.once('ready-to-show', () => win.show());
  // A página é local e não tem links; qualquer tentativa de navegar ou abrir janela é recusada.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return win;
}

module.exports = { createSettingsWindow };
