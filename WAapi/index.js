import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import express from 'express';
import dotenv from 'dotenv';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = pino({ level: 'info' });
const app = express();
const port = process.env.PORT || 3001;
const apiKey = process.env.API_KEY;

app.use(express.json());

// API Key Middleware
const authenticate = (req, res, next) => {
    const providedKey = req.headers['x-api-key'];
    if (!apiKey || providedKey === apiKey) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'auth_info'));

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            logger.info('Connection closed, reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            logger.info('WhatsApp connection opened successfully');
        }
    });
}

app.post('/send', authenticate, async (req, res) => {
    const { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ error: 'Phone and message are required' });
    }

    if (!sock || sock.user === undefined) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }

    try {
        const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true });
    } catch (error) {
        logger.error('Failed to send message', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

app.get('/status', (req, res) => {
    res.json({
        connected: !!(sock && sock.user),
        user: sock?.user || null
    });
});

app.listen(port, () => {
    logger.info(`WAapi listening at http://localhost:${port}`);
    connectToWhatsApp();
});
