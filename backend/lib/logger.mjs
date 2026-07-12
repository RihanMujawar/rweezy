const levelRank = { error: 0, warn: 1, info: 2 };
const currentLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "warn" : "info");

function shouldLog(level) {
  const requested = levelRank[level] ?? levelRank.info;
  const current = levelRank[currentLevel] ?? levelRank.info;
  return requested <= current;
}

export function logEvent(level, message, meta = {}) {
  if (!shouldLog(level)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function logRequestError(req, url, status, error, requestId) {
  logEvent("error", "request_failed", {
    method: req.method,
    path: url.pathname,
    status,
    requestId,
    error: error instanceof Error ? error.message : String(error),
    provider:
      error instanceof Error && /mapbox|postgres|auth/i.test(error.message)
        ? error.message.split(":")[0]?.trim()
        : undefined,
  });
}
