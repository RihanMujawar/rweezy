import express from "express";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import qrcodeTerminal from "qrcode-terminal";
import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve("../../.env") });
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.WHATSAPP_SIDECAR_PORT || 4001;
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "rweezy-internal-bypass-secret-12345!";
const BAILEYS_AUTH_DIR = process.env.BAILEYS_AUTH_DIR || "./baileys_auth_info";
const BAILEYS_PHONE = process.env.BAILEYS_PHONE || "";
const WHATSAPP_OTP_DEV_BYPASS = process.env.WHATSAPP_OTP_DEV_BYPASS === "true";

let sock = null;
let isConnectionOpen = false;
let pairingDone = false;
const baileysLogger = pino({ level: "warn" });

function toWhatsAppChatId(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new Error("A valid WhatsApp phone number with country code is required");
  }
  return `${digits}@s.whatsapp.net`;
}

async function connectWhatsApp() {
  try {
    if (BAILEYS_PHONE) {
      const credsPath = path.join(BAILEYS_AUTH_DIR, "creds.json");
      if (fs.existsSync(credsPath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(credsPath, "utf8"));
          if (!existing.me?.id) {
            fs.rmSync(BAILEYS_AUTH_DIR, { recursive: true, force: true });
            console.log("[Baileys] Cleared stale auth state for fresh phone pairing");
          }
        } catch {
          fs.rmSync(BAILEYS_AUTH_DIR, { recursive: true, force: true });
        }
      }
    }

    const { state, saveCreds } = await useMultiFileAuthState(BAILEYS_AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: baileysLogger,
      browser: ["Rweezy", "Chrome", "120.0.0"],
    });

    sock.ev.on("creds.update", saveCreds);

    pairingDone = false;

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && BAILEYS_PHONE && !pairingDone) {
        pairingDone = true;
        sock.requestPairingCode(BAILEYS_PHONE).then((code) => {
          console.log(`\n========================================\n[Baileys] Enter this pairing code on WhatsApp:\n👉 ${code} 👈\n========================================\n`);
        }).catch((err) => {
          console.error("[Baileys] Pairing failed:", err.message);
        });
      }

      if (qr && !BAILEYS_PHONE) {
        console.log("[Baileys] Scan this QR code with WhatsApp:");
        qrcodeTerminal.generate(qr, { small: true });
      }

      if (connection === "open") {
        isConnectionOpen = true;
        console.log("[Baileys] Connected to WhatsApp as user:", sock.user?.id);
      }

      if (connection === "close") {
        isConnectionOpen = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut &&
          statusCode !== DisconnectReason.badSession;

        console.log(`[Baileys] Connection closed. Code: ${statusCode}, Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          console.log("[Baileys] Reconnecting in 5 seconds...");
          setTimeout(connectWhatsApp, 5000);
        } else {
          console.log("[Baileys] Logged out. Stale credentials. Delete auth folder and restart sidecar.");
        }
      }
    });
  } catch (error) {
    console.error("[Baileys] Init failed:", error.message);
    setTimeout(connectWhatsApp, 10000);
  }
}

connectWhatsApp();

function authenticate(req, res, next) {
  const token = req.headers["x-internal-token"];
  if (!token || token !== INTERNAL_TOKEN) {
    return res.status(401).json({ error: "Unauthorized sidecar request" });
  }
  next();
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    whatsapp_connected: isConnectionOpen,
    dev_bypass: WHATSAPP_OTP_DEV_BYPASS,
  });
});

app.post("/send-otp", authenticate, async (req, res) => {
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.status(400).json({ error: "Missing phone or code" });
  }

  const text = `Your Rweezy verification code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`;
  console.log(`[Sidecar] Sending OTP code ${code} to ${phone}`);

  if (WHATSAPP_OTP_DEV_BYPASS) {
    console.log(`[Sidecar] Dev bypass active. OTP code ${code} logged above.`);
    return res.json({ ok: true, dev_bypass: true });
  }

  if (!isConnectionOpen || !sock) {
    return res.status(503).json({ error: "WhatsApp sidecar is not connected to WhatsApp Web" });
  }

  try {
    const jid = toWhatsAppChatId(phone);
    await sock.sendMessage(jid, { text });
    res.json({ ok: true });
  } catch (err) {
    console.error(`[Sidecar] Failed to send OTP:`, err.message);
    res.status(502).json({ error: err.message });
  }
});

app.post("/send-message", authenticate, async (req, res) => {
  const { phone, text } = req.body;
  if (!phone || !text) {
    return res.status(400).json({ error: "Missing phone or text" });
  }

  console.log(`[Sidecar] Sending message to ${phone}`);

  if (WHATSAPP_OTP_DEV_BYPASS) {
    console.log(`[Sidecar] Dev bypass active. Message: "${text}"`);
    return res.json({ ok: true, dev_bypass: true });
  }

  if (!isConnectionOpen || !sock) {
    return res.status(503).json({ error: "WhatsApp sidecar is not connected to WhatsApp Web" });
  }

  try {
    const jid = toWhatsAppChatId(phone);
    await sock.sendMessage(jid, { text });
    res.json({ ok: true });
  } catch (err) {
    console.error(`[Sidecar] Failed to send message:`, err.message);
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[WhatsApp Sidecar] Running internally on http://127.0.0.1:${PORT}`);
});
