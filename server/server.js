const express = require('express');
const { Bot } = require('node-telegram-bot-api');
const { run } = require('node-telegram-bot-api/node');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const TOKEN = '8912693484:AAEOqu6Q3SqiaUIiRqw0KaaEI3vsOCIgmEE';
const PORT = process.env.PORT || 3000;

// Инициализируем бота
const bot = new Bot(TOKEN);
const app = express();

app.use(express.json());
app.use(cors());

const dbPath = path.join(__dirname, 'users.json');
const usersDB = new Map();

function loadUsers() {
    try {
        if (!fs.existsSync(dbPath)) return;
        const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        for (const [code, chatId] of Object.entries(raw)) {
            usersDB.set(code, chatId);
        }
        console.log(`Загружено привязок: ${usersDB.size}`);
    } catch (err) {
        console.error('Не удалось прочитать users.json:', err);
    }
}

function saveUsers() {
    const raw = Object.fromEntries(usersDB);
    fs.writeFileSync(dbPath, JSON.stringify(raw, null, 2));
}

loadUsers();

// Обработка команды /start с параметром (Deep Link)
// Ссылка вида t.me/dl_match_bot?start=8492
bot.command('start', (ctx) => {
    const chatId = ctx.chatId;
    const clientCode = typeof ctx.match === 'string' ? ctx.match.trim() : '';

    if (!chatId) {
        return;
    }

    if (clientCode) {
        const prev = usersDB.get(clientCode);
        usersDB.set(clientCode, chatId);
        if (prev !== chatId) {
            saveUsers();
        }

        console.log(`Привязан код ${clientCode} к чату ${chatId}`);
        return ctx.reply(`✅ Успешно! Твой клиент (код ${clientCode}) привязан. Теперь я буду присылать уведомления о найденных матчах.`);
    }

    return ctx.reply('Привет! Запусти мод на ПК, и перейди по ссылке, которую он выдаст, чтобы привязать уведомления.');
});

// API Endpoint, куда стучится локальный мод Васяна
app.post('/api/notify', async (req, res) => {
    const { code, event } = req.body;

    if (!code) {
        return res.status(400).json({ error: 'Не указан код клиента' });
    }

    const chatId = usersDB.get(code);

    if (!chatId) {
        return res.status(404).json({ error: 'Клиент не привязан к Telegram' });
    }

    if (event === 'match_found') {
        try {
            console.log(`Notify code=${code} chatId=${chatId}`);
            await bot.api.sendMessage({
                chat_id: chatId,
                text: '🎮 Матч в Deadlock найден! Разворачивай игру.',
            });
            return res.json({ success: true });
        } catch (err) {
            console.error('Не удалось отправить сообщение в Telegram:', err);
            return res.status(502).json({ error: 'Не удалось отправить сообщение в Telegram' });
        }
    }

    res.status(400).json({ error: 'Неизвестный ивент' });
});
app.get('/api/test', (req, res) => {
    res.json({ success: true, message: 'Hello, World!' });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});

async function skipOldTelegramUpdates() {
    try {
        const updates = await bot.api.getUpdates({ timeout: 0, limit: 100 });
        if (!updates.length) return;
        const lastId = updates[updates.length - 1].update_id;
        await bot.api.getUpdates({ offset: lastId + 1, timeout: 0, limit: 1 });
        console.log(`Пропущено старых апдейтов Telegram: ${updates.length}`);
    } catch (err) {
        console.error('Не удалось сбросить апдейты Telegram:', err);
    }
}

skipOldTelegramUpdates()
    .then(() => run(bot))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
