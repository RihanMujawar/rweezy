import { env } from "./env.mjs";

const DEFAULT_TIMEOUT_MS = 10_000;

export class OpenWAError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message, { cause });
    this.name = "OpenWAError";
    this.status = status;
  }
}

export function isOpenWAConfigured() {
  return Boolean(env.openwaBaseUrl && env.openwaApiKey && env.openwaSessionId);
}

export function toWhatsAppChatId(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new OpenWAError("A valid WhatsApp phone number with country code is required", {
      status: 400,
    });
  }
  return `${digits}@c.us`;
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function openwaRequest(path, {
  method = "GET",
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!isOpenWAConfigured()) {
    throw new OpenWAError(
      "OpenWA is not configured. Add OPENWA_BASE_URL, OPENWA_API_KEY, and OPENWA_SESSION_ID to backend/.env.",
      { status: 500 },
    );
  }

  const url = `${env.openwaBaseUrl.replace(/\/+$/, "")}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.openwaApiKey,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new OpenWAError(
      timedOut
        ? `OpenWA did not respond within ${timeoutMs}ms`
        : "Could not connect to the OpenWA server",
      { cause: error },
    );
  }

  const payload = await readResponse(response);
  if (!response.ok) {
    const detail =
      (payload && typeof payload === "object" && (payload.message || payload.error)) ||
      (typeof payload === "string" && payload) ||
      `OpenWA request failed with status ${response.status}`;
    throw new OpenWAError(String(detail), {
      status: response.status >= 500 ? 502 : response.status,
    });
  }

  return payload;
}

export function sendWhatsAppText(phone, text, options = {}) {
  const sessionId = encodeURIComponent(env.openwaSessionId);
  return openwaRequest(`/api/sessions/${sessionId}/messages/send-text`, {
    method: "POST",
    body: {
      chatId: toWhatsAppChatId(phone),
      text: String(text),
    },
    ...options,
  });
}
