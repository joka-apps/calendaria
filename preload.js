const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData:     ()            => ipcRenderer.invoke('getData'),
  saveDay:     (key, data)   => ipcRenderer.invoke('saveDay', key, data),
  getDrawing:  (key)         => ipcRenderer.invoke('getDrawing', key),
  saveDrawing: (key, url)    => ipcRenderer.invoke('saveDrawing', key, url),
  savePending: (tasks)       => ipcRenderer.invoke('savePending', tasks),
  getPrefs:    ()            => ipcRenderer.invoke('getPrefs'),
  savePrefs:   (prefs)       => ipcRenderer.invoke('savePrefs', prefs),
});
