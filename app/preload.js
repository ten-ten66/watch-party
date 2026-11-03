const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  start: (opts) => ipcRenderer.invoke('start', opts),
  leave: () => ipcRenderer.invoke('leave'),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, data) => cb(data))
});
