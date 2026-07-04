import crypto from "node:crypto";
import { env } from "./env.mjs";
import { HttpError } from "./http.mjs";

const otpStore = new Map();
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function signingSecret() {
  return env.whatsappOtpSecret || env.jwtSecret || "dev-whatsapp-otp-secret";
}

function hashOtp(phone, code) {
  return crypto.createHmac("sha256", signingSecret()).update(`${phone}:${code}`).digest("hex");
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function toWhatsAppJid(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return `${digits}@c.us`;
}

function openwaConfigured() {
  return Boolean(env.openwaBaseUrl && env.openwaApiKey && env.openwaSessionId);
}

async function sendWhatsAppMessage(phone, text) {
  if (!openwaConfigured()) {
    throw new HttpError(
      500,
      "WhatsApp OTP is not configured. Add OPENWA_BASE_URL, OPENWA_API_KEY, and OPENWA_SESSION_ID to backend .env.",
    );
  }

  const chatId = toWhatsAppJid(phone);
  const url = `${env.openwaBaseUrl.replace(/\/+$/, "")}/api/sessions/${env.openwaSessionId}/messages/send-text`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": env.openwaApiKey,
    },
    body: JSON.stringify({
      chatId,
      text,
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.message || payload?.error || "Failed to send WhatsApp OTP";
    throw new HttpError(response.status >= 500 ? 502 : 400, message);
  }

  return response.json();
}

export async function sendWhatsAppOtp(phone) {
  const code = generateCode();
  otpStore.set(phone, {
    hash: hashOtp(phone, code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });

  if (env.whatsappOtpDevBypass === "true") {
    return { ok: true, provider: "whatsapp", devCode: code };
  }

  await sendWhatsAppMessage(
    phone,
    `Your Rweezy verification code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`,
  );

  return { ok: true, provider: "whatsapp" };
}

export function verifyWhatsAppOtp(phone, code) {
  const normalizedCode = String(code ?? "").trim();
  const record = otpStore.get(phone);

  if (env.whatsappOtpDevBypass === "true" && env.whatsappOtpDevBypassCode) {
    if (normalizedCode === String(env.whatsappOtpDevBypassCode).trim()) {
      otpStore.delete(phone);
      return phone;
    }
  }

  if (!record) {
    throw new HttpError(400, "OTP is required. Request a new code.");
  }
  if (record.expiresAt < Date.now()) {
    otpStore.delete(phone);
    throw new HttpError(400, "OTP expired. Request a new code.");
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(phone);
    throw new HttpError(400, "Too many incorrect OTP attempts. Request a new code.");
  }
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new HttpError(400, "Enter the 6-digit OTP code");
  }

  record.attempts += 1;
  const expected = Buffer.from(record.hash, "hex");
  const actual = Buffer.from(hashOtp(phone, normalizedCode), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new HttpError(400, "OTP is incorrect");
  }

  otpStore.delete(phone);
  return phone;
}
