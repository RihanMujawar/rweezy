import crypto from "node:crypto";
import { env } from "./env.mjs";
import { HttpError } from "./http.mjs";

const TOKEN_TTL_MS = 15 * 60 * 1000;

function signingSecret() {
  return env.phoneVerificationSecret || env.jwtSecret || "dev-phone-verification-secret";
}

export function createPhoneVerificationToken(phone) {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${phone}:${expiresAt}`;
  const signature = crypto.createHmac("sha256", signingSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}:${signature}`).toString("base64url");
}

export function verifyPhoneVerificationToken(token, expectedPhone) {
  if (!token) {
    throw new HttpError(400, "Phone verification is required. Verify your phone number with the OTP code.");
  }

  let decoded = "";
  try {
    decoded = Buffer.from(String(token), "base64url").toString("utf8");
  } catch {
    throw new HttpError(400, "Phone verification token is invalid. Verify your phone again.");
  }

  const parts = decoded.split(":");
  if (parts.length !== 3) {
    throw new HttpError(400, "Phone verification token is invalid. Verify your phone again.");
  }

  const [phone, expiresAtRaw, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  const payload = `${phone}:${expiresAtRaw}`;
  const expectedSignature = crypto.createHmac("sha256", signingSecret()).update(payload).digest("hex");

  const signatureOk =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  if (!signatureOk) {
    throw new HttpError(400, "Phone verification token is invalid. Verify your phone again.");
  }

  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    throw new HttpError(400, "Phone verification expired. Request a new OTP code.");
  }

  if (phone !== expectedPhone) {
    throw new HttpError(400, "Phone verification does not match. Verify your phone again.");
  }

  return phone;
}
