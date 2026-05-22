export function logEvent(level, message, meta = {}) {
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
      error instanceof Error && /mapbox|supabase|auth/i.test(error.message)
        ? error.message.split(":")[0]?.trim()
        : undefined,
  });
}
