const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  onUsage: (cb) => ipcRenderer.on('usage', (_e, payload) => cb(payload)),
  onPrefs: (cb) => ipcRenderer.on('prefs', (_e, payload) => cb(payload)),
  ready: () => ipcRenderer.send('ready'),
  refresh: () => ipcRenderer.send('refresh'),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (deltaY) => ipcRenderer.send('drag-move', deltaY),
  tabHeight: (h) => ipcRenderer.send('tab-height', h),
  contextMenu: () => ipcRenderer.send('context-menu'),
});
