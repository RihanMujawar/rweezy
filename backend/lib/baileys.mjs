import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { env } from "./env.mjs";
import { logEvent } from "./logger.mjs";

let sock = null;
let connectPromise = null;
let resolveConnect = null;
let reconnectTimer = null;

const baileysLogger = pino({ level: "warn" });

export class BaileysError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message, { cause });
    this.name = "BaileysError";
    this.status = status;
  }
}

export function isBaileysConfigured() {
  return Boolean(env.baileysAuthDir);
}

export function toWhatsAppChatId(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new BaileysError(
      "A valid WhatsApp phone number with country code is required",
      { status: 400 },
    );
  }
  return `${digits}@s.whatsapp.net`;
}

function cleanupState() {
  sock = null;
  connectPromise = null;
  resolveConnect = null;
}

async function connect() {
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(env.baileysAuthDir);
      const { version } = await fetchLatestBaileysVersion();

      const newSock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: baileysLogger,
        browser: ["Rweezy", "Chrome", "120.0.0"],
      });

      newSock.ev.on("creds.update", saveCreds);

      newSock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          logEvent("info", "baileys_qr_received", { hint: "Scan the QR code printed in the terminal to link WhatsApp" });
        }

        if (connection === "open") {
          logEvent("info", "baileys_connected", { user: newSock.user?.id });
          if (resolveConnect) {
            resolveConnect();
            resolveConnect = null;
          }
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect =
            statusCode !== DisconnectReason.loggedOut &&
            statusCode !== DisconnectReason.badSession;

          logEvent("info", "baileys_connection_closed", {
            code: statusCode,
            shouldReconnect,
          });

          cleanupState();

          if (shouldReconnect) {
            const delay = 5000;
            logEvent("info", "baileys_reconnecting", { delay });
            reconnectTimer = setTimeout(connect, delay);
          } else {
            logEvent("warn", "baileys_logged_out", {
              message: "WhatsApp session invalid. Delete the auth directory and restart to re-link.",
            });
          }
        }
      });

      sock = newSock;
      return newSock;
    } catch (error) {
      cleanupState();
      logEvent("error", "baileys_connect_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      reconnectTimer = setTimeout(connect, 10000);
      throw error;
    }
  })();

  return connectPromise;
}

async function ensureConnected() {
  if (sock?.user) return sock;

  const socket = await connect();

  if (socket?.user) return socket;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      resolveConnect = null;
      reject(new BaileysError("WhatsApp connection timed out. Check server logs for QR code.", { status: 502 }));
    }, 30_000);

    resolveConnect = () => {
      clearTimeout(timeout);
      resolve();
    };
  });

  return sock;
}

export async function sendWhatsAppText(phone, text, options = {}) {
  if (!isBaileysConfigured()) {
    throw new BaileysError(
      "Baileys is not configured. Add BAILEYS_AUTH_DIR to your .env file.",
      { status: 500 },
    );
  }

  const socket = await ensureConnected();
  if (!socket?.user) {
    throw new BaileysError("WhatsApp is not connected. Check server logs for QR code.", {
      status: 502,
    });
  }

  const jid = toWhatsAppChatId(phone);
  const content = { text: String(text) };
  const opts = options?.waitForAck ? { waitForAck: true } : {};
  await socket.sendMessage(jid, content, opts);
}
