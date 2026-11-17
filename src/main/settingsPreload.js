const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (key, value) => ipcRenderer.send('settings:set', key, value),
  display: (id, enabled) => ipcRenderer.send('settings:display', id, enabled),
  action: (name) => ipcRenderer.send('settings:action', name),
  onState: (cb) => ipcRenderer.on('settings:state', (_e, state) => cb(state)),
});
