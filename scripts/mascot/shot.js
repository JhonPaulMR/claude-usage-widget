// Gera docs/mascote-poses.png a partir de scripts/mascot/sheet.html. Uso: npm run mascot:sheet
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1228, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadFile(path.join(__dirname, 'sheet.html'));
  const height = await win.webContents.executeJavaScript('document.documentElement.scrollHeight');
  win.setContentSize(1228, Math.min(height, 4000));
  await new Promise((r) => setTimeout(r, 400));
  const out = path.join(__dirname, '..', '..', 'docs', 'mascote-poses.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, (await win.capturePage()).toPNG());
  console.log('Folha gerada em', out);
  app.quit();
});
