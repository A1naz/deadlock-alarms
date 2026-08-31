const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cors = require('cors');

const TOKEN = '8912693484:AAEOqu6Q3SqiaUIiRqw0KaaEI3vsOCIgmEE';
const PORT = process.env.PORT || 3000;

// Инициализируем бота
const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();

app.use(express.json());
app.use(cors());

// Временная база данных (Код клиента -> Chat ID)
// В идеале перенести в MongoDB
const usersDB = new Map();

// Обработка команды /start с параметром (Deep Link)
// Ссылка вида t.me/dl_match_bot?start=8492
bot.onText(/\/start (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const clientCode = match[1]; // Те самые 4 цифры

    usersDB.set(clientCode, chatId);
    
    bot.sendMessage(chatId, `✅ Успешно! Твой клиент (код ${clientCode}) привязан. Теперь я буду присылать уведомления о найденных матчах.`);
    console.log(`Привязан код ${clientCode} к чату ${chatId}`);
});

// Стандартный старт без параметра
bot.onText(/\/start$/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Привет! Запусти мод на ПК, и перейди по ссылке, которую он выдаст, чтобы привязать уведомления.');
});

// API Endpoint, куда стучится локальный мод Васяна
app.post('/api/notify', (req, res) => {
    const { code, event } = req.body;

    if (!code) {
        return res.status(400).json({ error: 'Не указан код клиента' });
    }

    const chatId = usersDB.get(code);

    if (!chatId) {
        return res.status(404).json({ error: 'Клиент не привязан к Telegram' });
    }

    if (event === 'match_found') {
        bot.sendMessage(chatId, '🎮 Матч в Deadlock найден! Разворачивай игру.');
        return res.json({ success: true });
    }

    res.status(400).json({ error: 'Неизвестный ивент' });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});