import crypto from "node:crypto";
import { env } from "./env.mjs";
import { HttpError } from "./http.mjs";
import { BaileysError, sendWhatsAppText } from "./baileys.mjs";

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

export async function sendWhatsAppOtp(phone) {
  const code = generateCode();
  otpStore.set(phone, {
    hash: hashOtp(phone, code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });

  if (env.whatsappOtpDevBypass) {
    return { ok: true, provider: "whatsapp", devCode: code };
  }

  try {
    await sendWhatsAppText(
      phone,
      `Your Rweezy verification code is ${code}. It expires in 10 minutes. Do not share this code with anyone.`,
      { timeoutMs: 20_000 },
    );
  } catch (error) {
    otpStore.delete(phone);
    if (error instanceof BaileysError) {
      throw new HttpError(error.status, error.message);
    }
    throw error;
  }

  return { ok: true, provider: "whatsapp" };
}

export function verifyWhatsAppOtp(phone, code) {
  const normalizedCode = String(code ?? "").trim();
  const record = otpStore.get(phone);

  if (env.whatsappOtpDevBypass && env.whatsappOtpDevBypassCode) {
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
