const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');

const DEADLOCK_APP_ID = '1422450';

let mainWindow;
let lastNotifyAt = 0;
let pollTimer = null;
let watchedLogPath = null;
let clientCode = null;
const NOTIFY_DEBOUNCE_MS = 30_000;
const STALE_LOG_MS = 15 * 60 * 1000;
const SERVER_URL = 'http://127.0.0.1:3000/api/notify';

const MATCH_FOUND_PATTERNS = [
    'k_emsggctoclientsdrticket',
    'recv msg 9100',
    'queuenewrequest( remote connect',
];

function isMatchFoundLine(line) {
    const lower = String(line).toLowerCase();
    return MATCH_FOUND_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isQueueLine(line) {
    const lower = String(line).toLowerCase();
    return lower.includes('send msg 9010') && lower.includes('startmatchmaking');
}

function isBackFromMatchLine(line) {
    const lower = String(line).toLowerCase();
    return lower.includes('map: "dl_hideout"')
        || lower.includes('k_emsgclienttogcleavelobby')
        || lower.includes('disconnect_by_user');
}

function sendStatus(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log-status', payload);
    }
}

async function notifyServerFromMain() {
    if (!clientCode) {
        console.error('Нет кода клиента, уведомление не отправить');
        sendStatus({ warning: true, text: 'Нет кода клиента. Перезапусти приложение.' });
        return;
    }

    try {
        const res = await fetch(SERVER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: clientCode, event: 'match_found' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            console.error('Сервер отклонил notify:', res.status, data);
            sendStatus({ warning: true, text: data.error || `Сервер ответил ${res.status}` });
            return;
        }
        console.log('Уведомление отправлено для кода', clientCode);
        sendStatus({ warning: false, text: 'Матч найден, уведомление отправлено в Telegram.' });
    } catch (err) {
        console.error('Не удалось достучаться до сервера:', err);
        sendStatus({ warning: true, text: 'Матч найден, но сервер недоступен. Запусти npm start в папке server.' });
    }
}

function emitMatchFound(matchedLine) {
    const now = Date.now();
    if (now - lastNotifyAt < NOTIFY_DEBOUNCE_MS) {
        console.log('Матч найден (повтор, пропуск):', matchedLine);
        return;
    }
    lastNotifyAt = now;

    console.log('Матч найден:', matchedLine);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('match-found');
    }
    notifyServerFromMain();
}

function startTailing(logPath) {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }

    watchedLogPath = logPath;
    let position = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
    let leftover = '';
    let lastStatusKey = '';
    let linesSeen = 0;
    // idle → queued → notified → idle (после выхода из матча)
    let phase = 'idle';

    const setWatchStatus = (warning, text) => {
        const key = `${warning}|${text}`;
        if (key === lastStatusKey) return;
        lastStatusKey = key;
        sendStatus({ warning, text });
    };

    const goIdle = (text) => {
        phase = 'idle';
        lastNotifyAt = 0;
        setWatchStatus(false, text);
    };

    const tick = () => {
        try {
            if (!fs.existsSync(logPath)) {
                position = 0;
                leftover = '';
                setWatchStatus(true, 'Нет console.log. Нажми «Запустить Deadlock».');
                return;
            }

            const stat = fs.statSync(logPath);
            const stale = (Date.now() - stat.mtimeMs) > STALE_LOG_MS;

            if (stat.size < position) {
                console.log('Лог игры перезаписан, читаем с начала');
                position = 0;
                leftover = '';
                goIdle('Игра перезапущена, слушаю логи…');
            }

            if (stat.size > position) {
                const length = stat.size - position;
                const buf = Buffer.alloc(length);
                const fd = fs.openSync(logPath, 'r');
                fs.readSync(fd, buf, 0, length, position);
                fs.closeSync(fd);
                position = stat.size;

                leftover += buf.toString('utf8');
                const lines = leftover.split(/\r?\n/);
                leftover = lines.pop() || '';
                for (const line of lines) {
                    linesSeen += 1;
                    if (isQueueLine(line)) {
                        phase = 'queued';
                        console.log('Встал в очередь:', line);
                        setWatchStatus(false, 'В очереди, жду матч…');
                    }
                    if (isMatchFoundLine(line)) {
                        phase = 'notified';
                        emitMatchFound(line);
                    }
                    if (phase === 'notified' && isBackFromMatchLine(line)) {
                        console.log('Вернулся из матча:', line);
                        goIdle('Матч закончен. Слушаю логи, жду следующую очередь…');
                    }
                }
            }

            if (stale && linesSeen === 0) {
                setWatchStatus(true, 'Лог игры не обновляется. Закрой Deadlock и нажми «Запустить Deadlock».');
            } else if (!stale && phase === 'idle') {
                setWatchStatus(false, 'Слушаю логи игры…');
            }
        } catch (err) {
            console.error('Ошибка чтения логов:', err);
        }
    };

    console.log('Слушаем логи:', logPath, 'с позиции', position);
    tick();
    pollTimer = setInterval(tick, 300);
}

function getSteamPath() {
    const regOutput = execSync('reg query HKCU\\Software\\Valve\\Steam /v SteamPath').toString();
    const match = regOutput.match(/SteamPath\s+REG_SZ\s+(.+)/);
    return match ? match[1].trim() : null;
}

function launchDeadlock() {
    const steamPath = getSteamPath();
    if (!steamPath) {
        throw new Error('Steam не найден');
    }

    const steamExe = path.join(steamPath, 'steam.exe');
    if (fs.existsSync(steamExe)) {
        spawn(steamExe, ['-applaunch', DEADLOCK_APP_ID, '-condebug'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        }).unref();
        return;
    }

    throw new Error('steam.exe не найден');
}

function findDeadlockPath() {
    try {
        const steamPath = getSteamPath();
        if (!steamPath) return null;
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

    ipcMain.on('start-tailing', (event, logPath, code) => {
        clientCode = code;
        startTailing(logPath);
    });

    ipcMain.handle('launch-deadlock', async () => {
        try {
            launchDeadlock();
            return { ok: true };
        } catch (err) {
            console.error('Не удалось запустить Deadlock:', err);
            return { ok: false, error: err.message };
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