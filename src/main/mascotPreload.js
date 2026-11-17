const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mascotBridge', {
  onState: (cb) => ipcRenderer.on('mascot:state', (_e, state) => cb(state)),
  onGaze: (cb) => ipcRenderer.on('mascot:gaze', (_e, g) => cb(g)),
  ready: () => ipcRenderer.send('mascot:ready'),
  setIgnore: (ignore) => ipcRenderer.send('mascot:ignore', ignore),
  dragStart: () => ipcRenderer.send('mascot:drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('mascot:drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('mascot:drag-end'),
  click: () => ipcRenderer.send('mascot:click'),
  menu: () => ipcRenderer.send('mascot:menu'),
});
