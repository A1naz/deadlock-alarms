const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    checkPath: () => ipcRenderer.invoke('check-path'),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    startTailing: (path, code) => ipcRenderer.send('start-tailing', path, code),
    openTelegram: (link) => ipcRenderer.send('open-telegram', link),
    onMatchFound: (callback) => ipcRenderer.on('match-found', callback),
    onLogStatus: (callback) => ipcRenderer.on('log-status', (_event, payload) => callback(payload)),
    launchDeadlock: () => ipcRenderer.invoke('launch-deadlock')
});
