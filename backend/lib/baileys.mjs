import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env.mjs";
import { logEvent } from "./logger.mjs";

let sock = null;
let connectPromise = null;
let resolveConnect = null;
let rejectConnect = null;
let reconnectTimer = null;
let pairingDone = false;
let isConnectionOpen = false;

const baileysLogger = pino({ level: "warn" });
const AUTH_TIMEOUT_MS = 90_000;

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
  isConnectionOpen = false;
  resolveConnect = null;
  rejectConnect = null;
}

function rejectPendingConnect(error) {
  if (rejectConnect) {
    rejectConnect(error);
    rejectConnect = null;
    resolveConnect = null;
  }
}

async function connect() {
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      // If phone pairing is configured and the auth dir has stale creds
      // (creds.json exists but no me.id), clear it so Baileys starts fresh.
      if (env.baileysPhone) {
        const credsPath = path.join(env.baileysAuthDir, "creds.json");
        if (fs.existsSync(credsPath)) {
          try {
            const existing = JSON.parse(fs.readFileSync(credsPath, "utf8"));
            if (!existing.me?.id) {
              fs.rmSync(env.baileysAuthDir, { recursive: true, force: true });
              logEvent("info", "baileys_auth_cleared", { message: "Cleared stale auth state for fresh phone pairing" });
            }
          } catch {
            fs.rmSync(env.baileysAuthDir, { recursive: true, force: true });
          }
        }
      }

      const { state, saveCreds } = await useMultiFileAuthState(env.baileysAuthDir);
      const { version } = await fetchLatestBaileysVersion();

      const newSock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: !env.baileysPhone,
        logger: baileysLogger,
        browser: ["Rweezy", "Chrome", "120.0.0"],
      });

      newSock.ev.on("creds.update", saveCreds);

      pairingDone = false;

      newSock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Phone pairing: when QR is emitted, socket is ready — request link code instead
        if (qr && env.baileysPhone && !pairingDone) {
          pairingDone = true;
          newSock.requestPairingCode(env.baileysPhone).then((code) => {
            logEvent("info", "baileys_pairing_code", {
              code,
              hint: `Enter this code on your WhatsApp phone: ${code}`,
            });
          }).catch((err) => {
            logEvent("error", "baileys_pairing_failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }

        if (qr && !env.baileysPhone) {
          logEvent("info", "baileys_qr_received", { hint: "Scan the QR code to link WhatsApp" });
        }

        if (connection === "open") {
          isConnectionOpen = true;
          logEvent("info", "baileys_connected", { user: newSock.user?.id });
          if (resolveConnect) {
            resolveConnect();
            resolveConnect = null;
            rejectConnect = null;
          }
        }

        if (connection === "close") {
          isConnectionOpen = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect =
            statusCode !== DisconnectReason.loggedOut &&
            statusCode !== DisconnectReason.badSession;

          logEvent("info", "baileys_connection_closed", {
            code: statusCode,
            shouldReconnect,
          });

          rejectPendingConnect(
            new BaileysError("WhatsApp connection closed before the message could be sent.", {
              status: 502,
            }),
          );
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
  // sock.user is populated from saved creds before the websocket opens.
  if (isConnectionOpen && sock) return sock;

  await connect();

  if (isConnectionOpen && sock) return sock;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      rejectConnect = null;
      resolveConnect = null;
      const msg = env.baileysPhone
        ? `WhatsApp pairing timed out after ${AUTH_TIMEOUT_MS / 1000}s. Check server logs for the pairing code.`
        : `WhatsApp connection timed out after ${AUTH_TIMEOUT_MS / 1000}s. Check server logs for QR code.`;
      reject(new BaileysError(msg, { status: 502 }));
    }, AUTH_TIMEOUT_MS);

    resolveConnect = () => {
      clearTimeout(timeout);
      resolve();
    };
    rejectConnect = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
  });

  return sock;
}

export async function warmupBaileys() {
  if (!isBaileysConfigured()) return;
  await ensureConnected();
}

export async function sendWhatsAppText(phone, text, options = {}) {
  if (!isBaileysConfigured()) {
    throw new BaileysError(
      "Baileys is not configured. Add BAILEYS_AUTH_DIR to your .env file.",
      { status: 500 },
    );
  }

  const socket = await ensureConnected();
  if (!isConnectionOpen || !socket) {
    const msg = env.baileysPhone
      ? "WhatsApp is not connected. Check server logs for the pairing code."
      : "WhatsApp is not connected. Check server logs for QR code.";
    throw new BaileysError(msg, { status: 502 });
  }

  const jid = toWhatsAppChatId(phone);
  const content = { text: String(text) };
  const opts = options?.waitForAck ? { waitForAck: true } : {};
  try {
    await socket.sendMessage(jid, content, opts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BaileysError(
      message.includes("Connection Closed")
        ? "WhatsApp is reconnecting. Please try again in a few seconds."
        : `Failed to send WhatsApp message: ${message}`,
      { status: 502, cause: error },
    );
  }
}
