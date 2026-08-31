const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { Tail } = require('tail');

let mainWindow;
let logTail = null;

// Функция автопоиска из предыдущего шага
function findDeadlockPath() {
    try {
        const regOutput = execSync('reg query HKCU\\Software\\Valve\\Steam /v SteamPath').toString();
        const match = regOutput.match(/SteamPath\s+REG_SZ\s+(.+)/);
        if (!match) return null;
        
        const steamPath = match[1].trim();
        const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
        if (!fs.existsSync(vdfPath)) return null;

        const vdfContent = fs.readFileSync(vdfPath, 'utf8');
        const paths = [...vdfContent.matchAll(/"path"\s+"([^"]+)"/g)].map(m => m[1].replace(/\\\\/g, '\\'));
        
        for (const libPath of paths) {
            const deadlockLogPath = path.join(libPath, 'steamapps', 'common', 'Deadlock', 'game', 'citadel', 'console.log');
            if (fs.existsSync(path.dirname(deadlockLogPath))) return deadlockLogPath;
        }
    } catch (e) {
        console.error('Ошибка автопоиска:', e);
    }
    return null;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 600,
        height: 500,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        autoHideMenuBar: true
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();

    // Обработчик автопоиска пути по запросу от UI
    ipcMain.handle('check-path', async () => {
        const logPath = findDeadlockPath();
        return logPath;
    });

    // Обработчик ручного выбора папки
    ipcMain.handle('select-folder', async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'Укажите папку Deadlock'
        });
        
        if (result.canceled) return null;
        
        // Проверяем, правильную ли папку выбрал юзер
        const selectedPath = result.filePaths[0];
        const logPath = path.join(selectedPath, 'game', 'citadel', 'console.log');
        
        if (fs.existsSync(path.dirname(logPath))) {
            return logPath;
        } else {
            return 'error_not_found';
        }
    });

    // Запуск прослушки логов
    ipcMain.on('start-tailing', (event, logPath) => {
        if (logTail) logTail.unwatch();
        
        if (fs.existsSync(logPath)) {
            logTail = new Tail(logPath, { follow: true, useWatchFile: true });
            logTail.on('line', (data) => {
                const line = data.toLowerCase();
                if (line.includes('match found') || line.includes('change matchmaking state')) {
                    // Отправляем сигнал в UI, что матч найден
                    mainWindow.webContents.send('match-found');
                }
            });
        }
    });

    // Открытие ссылки в браузере/десктопном Telegram по клику
    ipcMain.on('open-telegram', (event, link) => {
        shell.openExternal(link);
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});