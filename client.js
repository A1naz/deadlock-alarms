const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function findDeadlockPath() {
    try {
        // Ищем путь к Steam в реестре Windows
        const regOutput = execSync('reg query HKCU\\Software\\Valve\\Steam /v SteamPath').toString();
        const match = regOutput.match(/SteamPath\s+REG_SZ\s+(.+)/);
        
        if (!match) return null;
        
        const steamPath = match[1].trim();
        const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
        
        if (!fs.existsSync(vdfPath)) return null;

        // Читаем список библиотек Steam
        const vdfContent = fs.readFileSync(vdfPath, 'utf8');
        const paths = [...vdfContent.matchAll(/"path"\s+"([^"]+)"/g)].map(m => m[1].replace(/\\\\/g, '\\'));
        
        // Проверяем каждую библиотеку на наличие Deadlock
        for (const libPath of paths) {
            const deadlockLogPath = path.join(libPath, 'steamapps', 'common', 'Deadlock', 'game', 'citadel', 'console.log');
            if (fs.existsSync(path.dirname(deadlockLogPath))) {
                return deadlockLogPath;
            }
        }
    } catch (e) {
        console.error('Ошибка автопоиска:', e);
    }
    return null;
}