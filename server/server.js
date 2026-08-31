const express = require('express');
const { Bot } = require('node-telegram-bot-api');
const { run } = require('node-telegram-bot-api/node');
const cors = require('cors');

const TOKEN = '8912693484:AAEOqu6Q3SqiaUIiRqw0KaaEI3vsOCIgmEE';
const PORT = process.env.PORT || 3000;

// Инициализируем бота
const bot = new Bot(TOKEN);
const app = express();

app.use(express.json());
app.use(cors());

// Временная база данных (Код клиента -> Chat ID)
// В идеале перенести в MongoDB
const usersDB = new Map();

// Обработка команды /start с параметром (Deep Link)
// Ссылка вида t.me/dl_match_bot?start=8492
bot.command('start', (ctx) => {
    const chatId = ctx.chatId;
    const clientCode = typeof ctx.match === 'string' ? ctx.match.trim() : '';

    if (!chatId) {
        return;
    }

    if (clientCode) {
        usersDB.set(clientCode, chatId);

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
        await bot.api.sendMessage({
            chat_id: chatId,
            text: '🎮 Матч в Deadlock найден! Разворачивай игру.',
        });
        return res.json({ success: true });
    }

    res.status(400).json({ error: 'Неизвестный ивент' });
});
app.get('/api/test', (req, res) => {
    res.json({ success: true, message: 'Hello, World!' });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});

run(bot).catch((err) => {
    console.error(err);
    process.exit(1);
});
