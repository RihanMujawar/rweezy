export function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeIndianPhone(value) {
  const raw = cleanText(value);
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+91${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }

  return raw;
}

export function isPublicApiRoute(method, pathname) {
  return (
    pathname === "/api/health" ||
    (method === "POST" && pathname === "/api/auth/login") ||
    (method === "POST" && pathname === "/api/auth/register") ||
    (method === "POST" && pathname === "/api/auth/phone/send-otp") ||
    (method === "POST" && pathname === "/api/auth/phone/verify-otp") ||
    (method === "POST" && pathname === "/api/auth/email/resend-verification") ||
    (method === "POST" && pathname === "/api/auth/password-reset/request") ||
    (method === "POST" && pathname === "/api/auth/password-reset/complete") ||
    (method === "POST" && pathname === "/api/auth/logout") ||
    (method === "GET" && pathname === "/api/map/route")
  );
}
