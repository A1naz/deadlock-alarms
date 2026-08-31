const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    checkPath: () => ipcRenderer.invoke('check-path'),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    startTailing: (path) => ipcRenderer.send('start-tailing', path),
    openTelegram: (link) => ipcRenderer.send('open-telegram', link),
    onMatchFound: (callback) => ipcRenderer.on('match-found', callback)
});