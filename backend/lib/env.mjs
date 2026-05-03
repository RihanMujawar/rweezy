import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(__dirname, "..");
export const ROOT_DIR = path.resolve(BACKEND_DIR, "..");

function parseEnvFile(raw) {
  const result = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

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

export const env = {
  host: process.env.BACKEND_HOST || "127.0.0.1",
  port: Number(process.env.BACKEND_PORT || 4000),
  frontendDevUrl: process.env.FRONTEND_DEV_URL || "http://127.0.0.1:3000",
  supabaseUrl: required("SUPABASE_URL"),
  supabasePublishableKey: required("SUPABASE_PUBLISHABLE_KEY"),
};
