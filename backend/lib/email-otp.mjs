import crypto from "node:crypto";
import tls from "node:tls";
import { env } from "./env.mjs";
import { HttpError } from "./http.mjs";

const emailOtpStore = new Map();
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function signingSecret() {
  return env.emailOtpSecret || env.supabaseServiceRoleKey || "dev-email-otp-secret";
}

function hashOtp(email, code) {
  return crypto.createHmac("sha256", signingSecret()).update(`${email}:${code}`).digest("hex");
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function smtpConfigured() {
  return Boolean(env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass && env.smtpFrom);
}

function encodeBase64(value) {
  return Buffer.from(String(value), "utf8").toString("base64");
}

function sanitizeHeader(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function dotStuff(value) {
  return String(value).replace(/^\./gm, "..");
}

function createSmtpClient() {
  const socket = tls.connect({
    host: env.smtpHost,
    port: env.smtpPort,
    servername: env.smtpHost,
    timeout: 20000,
  });

  let buffer = "";

  function readResponse() {
    return new Promise((resolve, reject) => {
      const onData = (chunk) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split(/\r?\n/).filter(Boolean);
        const last = lines.at(-1);
        if (!last || !/^\d{3} /.test(last)) return;
        cleanup();
        const response = buffer;
        buffer = "";
        resolve(response);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onTimeout = () => {
        cleanup();
        reject(new Error("SMTP connection timed out"));
      };
      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("timeout", onTimeout);
      };
      socket.on("data", onData);
      socket.once("error", onError);
      socket.once("timeout", onTimeout);
    });
  }

  async function command(line, expectedPrefix) {
    socket.write(`${line}\r\n`);
    const response = await readResponse();
    if (!response.startsWith(expectedPrefix)) {
      throw new Error(`SMTP command failed: ${response.trim()}`);
    }
    return response;
  }

  return { socket, readResponse, command };
}

async function sendSmtpMail({ to, subject, text, html }) {
  if (!smtpConfigured()) {
    throw new HttpError(
      500,
      "Email OTP is not configured. Add Gmail SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM to backend .env.",
    );
  }

  const client = createSmtpClient();
  try {
    const greeting = await client.readResponse();
    if (!greeting.startsWith("220")) {
      throw new Error(`SMTP greeting failed: ${greeting.trim()}`);
    }

    await client.command("EHLO rweezy.local", "250");
    await client.command("AUTH LOGIN", "334");
    await client.command(encodeBase64(env.smtpUser), "334");
    await client.command(encodeBase64(env.smtpPass), "235");
    await client.command(`MAIL FROM:<${env.smtpFrom}>`, "250");
    await client.command(`RCPT TO:<${to}>`, "250");
    await client.command("DATA", "354");

    const boundary = `rweezy-${crypto.randomUUID()}`;
    const messageBody = [
      `From: ${sanitizeHeader(env.smtpFrom)}`,
      `To: ${sanitizeHeader(to)}`,
      `Subject: ${sanitizeHeader(subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      text,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: 7bit",
      "",
      html,
      "",
      `--${boundary}--`,
    ].join("\r\n");
    const message = [
      dotStuff(messageBody),
      ".",
      "",
    ].join("\r\n");

    client.socket.write(message);
    const dataResponse = await client.readResponse();
    if (!dataResponse.startsWith("250")) {
      throw new Error(`SMTP DATA failed: ${dataResponse.trim()}`);
    }
    await client.command("QUIT", "221").catch(() => null);
  } finally {
    client.socket.end();
  }
}

export async function sendPasswordResetEmailOtp(email) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw new HttpError(400, "Email is required");
  }

  const code = env.emailOtpDevBypass ? env.emailOtpDevBypassCode : generateCode();
  emailOtpStore.set(normalizedEmail, {
    hash: hashOtp(normalizedEmail, code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });

  if (env.emailOtpDevBypass) {
    console.warn(`Password reset email OTP for ${normalizedEmail}: ${code}`);
    return;
  }

  await sendSmtpMail({
    to: normalizedEmail,
    subject: "Your Rweezy password reset code",
    text: `Your Rweezy password reset code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your Rweezy password reset code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
  });
}

export function verifyPasswordResetEmailOtp(email, code) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const normalizedCode = String(code ?? "").trim();
  const record = emailOtpStore.get(normalizedEmail);

  if (!record) {
    throw new HttpError(400, "Email OTP is required. Request a new reset code.");
  }
  if (record.expiresAt < Date.now()) {
    emailOtpStore.delete(normalizedEmail);
    throw new HttpError(400, "Email OTP expired. Request a new reset code.");
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    emailOtpStore.delete(normalizedEmail);
    throw new HttpError(400, "Too many incorrect email OTP attempts. Request a new reset code.");
  }
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new HttpError(400, "Enter the 6-digit email OTP");
  }

  record.attempts += 1;
  const expected = Buffer.from(record.hash, "hex");
  const actual = Buffer.from(hashOtp(normalizedEmail, normalizedCode), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new HttpError(400, "Email OTP is incorrect");
  }

  emailOtpStore.delete(normalizedEmail);
  return normalizedEmail;
}
