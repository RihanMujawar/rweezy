import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(__dirname, "..");
export const ROOT_DIR = path.resolve(BACKEND_DIR, "..");

function parseEnvFile(raw) {
  const result = {};
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const jsonOpener = value === "{" || value === '"{' || value === "'{";
    if (jsonOpener) {
      const closingLine =
        value === '"{' ? '}"' : value === "'{" ? "}'" : "}";
      const parts = [value];
      while (index + 1 < lines.length) {
        index += 1;
        parts.push(lines[index]);
        if (lines[index].trim() === closingLine) break;
      }
      value = parts.join("\n").trim();
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value.replace(/\\n/g, "\n");
  }

  return result;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;

  const parsed = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadEnv() {
  loadEnvFile(path.join(BACKEND_DIR, ".env"));
  loadEnvFile(path.join(ROOT_DIR, ".env"));
}

loadEnv();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export const env = {
  host: process.env.BACKEND_HOST || "127.0.0.1",
  port: Number(process.env.BACKEND_PORT || 4000),
  frontendDevUrl: process.env.FRONTEND_DEV_URL || "http://127.0.0.1:3000",
  supabaseUrl: required("SUPABASE_URL"),
  supabasePublishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN || process.env.VITE_MAPBOX_ACCESS_TOKEN || "",
  corsAllowAll: process.env.CORS_ALLOW_ALL === "true" || process.env.NODE_ENV !== "production",
  corsAllowedOrigins: parseCsv(process.env.CORS_ALLOWED_ORIGINS),
  cookieSecure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
  fcmServerKey: process.env.FCM_SERVER_KEY || "",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || "",
  twilioDevBypass: process.env.TWILIO_DEV_BYPASS === "true",
  twilioDevBypassCode: process.env.TWILIO_DEV_BYPASS_CODE || "123456",
  phoneVerificationSecret: process.env.PHONE_VERIFICATION_SECRET || "",
  emailOtpSecret: process.env.EMAIL_OTP_SECRET || "",
  emailOtpDevBypass: process.env.EMAIL_OTP_DEV_BYPASS === "true",
  emailOtpDevBypassCode: process.env.EMAIL_OTP_DEV_BYPASS_CODE || "123456",
  smtpHost: process.env.SMTP_HOST || "smtp.gmail.com",
  smtpPort: Number(process.env.SMTP_PORT || 465),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  authRequireEmailVerification: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== "false",
  jwtSecret: process.env.JWT_SECRET || "rweezy-secret-key-123",
  refreshSecret: process.env.REFRESH_SECRET || "rweezy-refresh-key-123",
  databaseUrl: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/rweezy",
};
