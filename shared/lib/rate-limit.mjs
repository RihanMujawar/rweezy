const buckets = new Map();
const enabled = process.env.RATE_LIMIT_ENABLED !== "false";

const DEFAULT_LIMITS = {
  "/api/auth/login": { windowMs: 60_000, max: 20 },
  "/api/auth/register": { windowMs: 60_000, max: 10 },
  "/api/auth/phone/send-otp": { windowMs: 60_000, max: 5 },
  "/api/auth/phone/verify-otp": { windowMs: 60_000, max: 15 },
  "/api/auth/password-reset/request": { windowMs: 60_000, max: 5 },
  "/api/auth/password-reset/complete": { windowMs: 60_000, max: 10 },
  "/api/auth/email/resend-verification": { windowMs: 60_000, max: 5 },
  "/api/chat": { windowMs: 60_000, max: 120 },
  "/api/live-location": { windowMs: 60_000, max: 300 },
};

function bucketKey(ip, pathname) {
  if (pathname.startsWith("/api/chat/")) return `${ip}:/api/chat`;
  return `${ip}:${pathname}`;
}

export function checkRateLimit(ip, pathname) {
  if (!enabled) return null;

  const rule =
    DEFAULT_LIMITS[pathname] ??
    (pathname.startsWith("/api/chat/") ? DEFAULT_LIMITS["/api/chat"] : null);

  if (!rule) return null;

  const key = bucketKey(ip, pathname);
  const now = Date.now();
  let entry = buckets.get(key);

  if (!entry || now - entry.start > rule.windowMs) {
    entry = { start: now, count: 0 };
    buckets.set(key, entry);
  }

  entry.count += 1;
  if (entry.count > rule.max) {
    return `Too many requests. Try again in ${Math.ceil((rule.windowMs - (now - entry.start)) / 1000)}s.`;
  }

  return null;
}
