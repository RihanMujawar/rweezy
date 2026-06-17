import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { prisma } from "./lib/prisma.mjs";
import { fileURLToPath } from "node:url";
import { ROOT_DIR, env } from "./lib/env.mjs";
import {
  createRequestId,
  getBearerToken,
  getCorsHeaders,
  HttpError,
  parseCookies,
  readJson,
  sendJson,
  sendText,
  serializeCookie,
} from "./lib/http.mjs";
import {
  createConfirmedUserWithPassword,
  createSessionForEmail,
  findUserByEmail,
  findUserEmailByPhone,
  getUserFromToken,
  refreshAuthSession,
  resendSignupConfirmation,

  revokeSession,

  signInWithPassword,
  signUpWithPassword,
  updateUserPassword,
} from "./lib/prisma-shim.mjs";
import {
  sendPasswordResetEmailOtp,
  verifyPasswordResetEmailOtp,
} from "./lib/email-otp.mjs";
import { checkRateLimit } from "./lib/rate-limit.mjs";
import {
  createPhoneVerificationToken,
  verifyPhoneVerificationToken,
} from "./lib/phone-verification.mjs";
import {
  sendPhoneVerificationCode,
  verifyPhoneVerificationCode,
} from "./lib/twilio.mjs";
import {
  assertStatusAdvance,
  estimateDeliveryAt,
  generateDeliveryPin,
  sanitizeComment,
} from "./lib/platform-helpers.mjs";
import { logEvent, logRequestError } from "./lib/logger.mjs";
import { cleanText, isPublicApiRoute, normalizeIndianPhone } from "./lib/request-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDistDir = path.join(ROOT_DIR, "frontend", "dist");
const frontendClientDir = path.join(frontendDistDir, "client");
const frontendServerEntryPath = path.join(frontendDistDir, "server", "index.js");
const ACCESS_COOKIE = "rweezy_access_token";
const REFRESH_COOKIE = "rweezy_refresh_token";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function buildPath(pathname, params = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    query.set(key, value);
  }

  const qs = query.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function firstRow(rows) {
  return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
}

function isMissingTableError(error, tableName) {
  if (!(error instanceof HttpError)) return false;
  const message = error.message.toLowerCase();
  const table = tableName.toLowerCase();
  return (
    [404, 422].includes(error.status) &&
    message.includes(table) &&
    (message.includes("schema cache") || message.includes("could not find the table"))
  );
}

function normalizeDeliveryOrder(row) {
  if (!row) return row;

  return {
    ...row,
    rider_id: row.rider_id ?? row.delivery_boy_id ?? null,
  };
}

function normalizeChatKind(kind) {
  return ["ride", "package", "food", "grocery"].includes(kind) ? kind : null;
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfLocalMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isOnOrAfter(dateValue, boundary) {
  const time = new Date(dateValue).getTime();
  return Number.isFinite(time) && time >= boundary.getTime();
}

function distanceKm(from, to) {
  if (!from || !to) return 0;
  const lat1 = Number(from.lat);
  const lng1 = Number(from.lng);
  const lat2 = Number(to.lat);
  const lng2 = Number(to.lng);

  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return 0;

  const toRad = (value) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const DEFAULT_CATALOG_RADIUS_KM = 25;
const MIN_CATALOG_RADIUS_KM = 1;
const MAX_CATALOG_RADIUS_KM = 100;

function cleanCompareText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isLocationMatchByText(location, row) {
  const userPincode = cleanCompareText(location?.pincode);
  const rowPincode = cleanCompareText(row?.pincode);
  if (userPincode && rowPincode) return userPincode === rowPincode;

  const userTown = cleanCompareText(location?.town_name);
  const rowTown = cleanCompareText(row?.town_name);
  if (userTown && rowTown) return userTown === rowTown;
  return false;
}

function filterCatalogRowsByLocation(rows, location, radiusKm = DEFAULT_CATALOG_RADIUS_KM) {
  if (!location) return rows ?? [];
  const data = rows ?? [];
  const hasTextLocation =
    Boolean(cleanCompareText(location?.pincode)) || Boolean(cleanCompareText(location?.town_name));

  const hasCoords = Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng));
  if (!hasCoords && !hasTextLocation) return data;
  if (hasCoords) {
    const nearby = data.filter((row) => {
      if (!Number.isFinite(Number(row?.lat)) || !Number.isFinite(Number(row?.lng))) return false;
      return (
        distanceKm(
          { lat: Number(location.lat), lng: Number(location.lng) },
          { lat: Number(row.lat), lng: Number(row.lng) },
        ) <= radiusKm
      );
    });
    if (nearby.length > 0) return nearby;
  }

  return data.filter((row) => isLocationMatchByText(location, row));
}

function normalizeCatalogRadius(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_CATALOG_RADIUS_KM;
  return Math.max(MIN_CATALOG_RADIUS_KM, Math.min(MAX_CATALOG_RADIUS_KM, Math.round(num)));
}

async function getCatalogRadiusKm() {
  try {
    const row = await prisma.platformSetting.findUnique({
      where: { key: "catalog_radius_km" },
      select: { value: true },
    });
    return normalizeCatalogRadius(row?.value);
  } catch (error) {
    if (!isMissingTableError(error, "platform_settings")) {
      console.warn(`Catalog radius setting unavailable: ${error.message}`);
    }
  }
  return DEFAULT_CATALOG_RADIUS_KM;
}

async function saveCatalogRadiusKm(token, radiusKm) {
  const value = normalizeCatalogRadius(radiusKm);
  const row = await prisma.platformSetting.upsert({
    where: { key: "catalog_radius_km" },
    update: { value },
    create: { key: "catalog_radius_km", value },
  });
  return normalizeCatalogRadius(row?.value);
}

function trimToken(value) {
  return String(value ?? "").trim();
}

async function sendFcmNotification({ token, title, body, data = {} }) {
  if (!env.fcmServerKey) {
    throw new HttpError(
      500,
      "Missing FCM_SERVER_KEY. Add your Firebase server key to backend .env and restart the server.",
    );
  }

  const targetToken = trimToken(token);
  if (!targetToken) throw new HttpError(400, "Push token is required");

  const response = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `key=${env.fcmServerKey}`,
    },
    body: JSON.stringify({
      to: targetToken,
      priority: "high",
      notification: {
        title: cleanText(title) || "Rweezy",
        body: cleanText(body) || "You have a new update.",
      },
      data: Object.fromEntries(
        Object.entries(data ?? {}).map(([key, value]) => [String(key), String(value ?? "")]),
      ),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, "Failed to deliver push notification");

  if (payload?.failure > 0) {
    const message = payload?.results?.[0]?.error;
    throw new HttpError(400, message ? `FCM rejected token: ${message}` : "FCM rejected notification");
  }

  return payload;
}

async function getUserCatalogLocation(userId) {
  const [profile, address] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: userId },
      select: { townName: true, pincode: true },
    }),
    prisma.savedAddress.findFirst({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      select: { lat: true, lng: true },
    }),
  ]);

  return {
    town_name: profile?.townName ?? null,
    pincode: profile?.pincode ?? null,
    lat: Number.isFinite(Number(address?.lat)) ? Number(address.lat) : null,
    lng: Number.isFinite(Number(address?.lng)) ? Number(address.lng) : null,
  };
}
function chatTarget(kind) {
  return {
    ride: { table: "rides", partnerColumn: "rider_id" },
    package: { table: "package_deliveries", partnerColumn: "rider_id" },
    food: { table: "food_orders", partnerColumn: "delivery_boy_id" },
    grocery: { table: "grocery_orders", partnerColumn: "delivery_boy_id" },
  }[kind];
}

function isChatParticipant(userId, row, partnerColumn) {
  return row?.customer_id === userId || row?.[partnerColumn] === userId;
}

async function getChatContext(user, kind, serviceId) {
  const normalizedKind = normalizeChatKind(kind);
  if (!normalizedKind) {
    throw new HttpError(400, "Invalid chat type");
  }

  const target = chatTarget(normalizedKind);
  const modelName = target.table.replace(/_([a-z])/g, (g) => g[1].toUpperCase()).slice(0, -1).replace(/ies$/, "y");
  const row = await prisma[modelName].findUnique({
    where: { id: serviceId },
    select: { id: true, customerId: true, [target.partnerColumn.replace(/_([a-z])/g, (g) => g[1].toUpperCase())]: true },
  });

  if (!row) {
    throw new HttpError(404, "Chat target not found");
  }

  const prismaPartnerColumn = target.partnerColumn.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
  const normalizedRow = {
    id: row.id,
    customer_id: row.customerId,
    [target.partnerColumn]: row[prismaPartnerColumn]
  };

  if (isChatParticipant(user.id, normalizedRow, target.partnerColumn)) {
    return { kind: normalizedKind, row: normalizedRow, partnerColumn: target.partnerColumn };
  }

  const roles = await getRoles(user.id);
  if (!roles.includes("admin")) {
    throw new HttpError(403, "You do not have access to this chat");
  }

  return { kind: normalizedKind, row: normalizedRow, partnerColumn: target.partnerColumn };
}
async function getChatRecipientUserIds(context, senderId) {
  const { row, partnerColumn } = context;
  const recipients = [];
  if (row.customer_id && row.customer_id !== senderId) {
    recipients.push(row.customer_id);
  }
  const partnerId = row[partnerColumn];
  if (partnerId && partnerId !== senderId) {
    recipients.push(partnerId);
  }
  return recipients;
}

function chatKindLabel(kind) {
  return (
    {
      ride: "Ride chat",
      package: "Package chat",
      food: "Food order chat",
      grocery: "Grocery order chat",
    }[kind] ?? "Chat"
  );
}
async function getProfileDisplayName(userId) {
  const profile = await prisma.profile.findUnique({
    where: { id: userId },
  });
  return cleanText(profile?.fullName) || "Someone";
}

async function getPushTokensForUsers(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const tokens = await prisma.userPushToken.findMany({
    where: { userId: { in: uniqueIds } },
    select: { token: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const seen = new Set();
  return (tokens ?? [])
    .map((row) => trimToken(row.token))
    .filter((token) => {
      if (!token || seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

async function trySendFcmNotification(params) {
  if (!env.fcmServerKey) return { ok: false, skipped: true };
  try {
    await sendFcmNotification(params);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to send push notification",
    };
  }
}

async function notifyChatRecipients({ senderId, context, kind, serviceId, messageBody }) {
  const recipientIds = getChatRecipientUserIds(context, senderId);
  if (recipientIds.length === 0) return;

  const [senderName, tokens] = await Promise.all([
    getProfileDisplayName(senderId),
    getPushTokensForUsers(recipientIds),
  ]);
  if (tokens.length === 0) return;

  const preview =
    messageBody.length > 120 ? `${messageBody.slice(0, 117)}...` : messageBody;
  const title = `${senderName} · ${chatKindLabel(kind)}`;

  await Promise.all(
    tokens.map((token) =>
      trySendFcmNotification({
        token,
        title,
        body: preview,
        data: {
          type: "chat",
          service_kind: kind,
          service_id: serviceId,
          sender_id: senderId,
        },
      }),
    ),
  );
}

function normalizeSignupRole(role) {
  return ["customer", "hotel_manager", "grocery_manager", "delivery_boy", "rider"].includes(role)
    ? role
    : "customer";
}

function normalizeBusinessRole(role) {
  return ["hotel_manager", "grocery_manager", "delivery_boy", "rider"].includes(role) ? role : null;
}

function requireText(value, label, max = 300) {
  const text = cleanText(value);
  if (!text) throw new HttpError(400, `${label} is required`);
  if (text.length > max) throw new HttpError(400, `${label} is too long`);
  return text;
}

function requireNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new HttpError(400, `${label} is required`);
  return number;
}

function validateRegistration(body) {
  const email = requireText(body.email, "Email", 320).toLowerCase();
  const fullName = requireText(body.full_name, "Full name", 120);
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, "Password must include at least one letter and one number");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email");

  const phone = normalizeIndianPhone(body.phone);
  if (!/^\+\d{10,15}$/.test(phone)) {
    throw new HttpError(400, "Enter a valid phone number with country code");
  }

  return { email, fullName, password, phone };
}

function validateCartItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "Add at least one item before checkout");
  }

  return items.map((item) => {
    const id = requireText(item.id, "Item id", 80);
    const name = requireText(item.name, "Item name", 160);
    const price = requireNumber(item.price, "Item price");
    const quantity = Number(item.quantity);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new HttpError(400, `${name} must have a quantity from 1 to 20`);
    }

    if (price < 0) throw new HttpError(400, `${name} has an invalid price`);
    return { id, name, price, quantity };
  });
}

function assertCancellable(row, kind) {
  if (!row) throw new HttpError(404, `${kind} not found`);
  if (["cancelled", "delivered", "completed"].includes(row.status)) {
    throw new HttpError(400, `${kind} can no longer be cancelled`);
  }
  if (["picked_up", "out_for_delivery", "started"].includes(row.status)) {
    throw new HttpError(400, `${kind} has already started. Contact support to cancel.`);
  }
}

const DEFAULT_COMMISSIONS = { restaurant: 10, grocery: 8, delivery: 12 };

async function getPlatformCommissions() {
  try {
    const row = await prisma.platformSetting.findUnique({
      where: { key: "commissions" },
      select: { value: true },
    });
    if (row?.value && typeof row.value === "object") {
      return { ...DEFAULT_COMMISSIONS, ...row.value };
    }
  } catch (error) {
    if (!isMissingTableError(error, "platform_settings")) {
      console.warn(`Commission settings unavailable: ${error.message}`);
    }
  }
  return DEFAULT_COMMISSIONS;
}

async function savePlatformCommissions(value) {
  const row = await prisma.platformSetting.upsert({
    where: { key: "commissions" },
    update: { value },
    create: { key: "commissions", value },
  });
  return row?.value ?? value;
}

async function deductGroceryStock(storeId, items) {
  const groceryItems = await prisma.groceryItem.findMany({
    where: {
      storeId,
      id: { in: items.map((item) => item.id) },
    },
    select: { id: true, stockQuantity: true },
  });
  const stockById = new Map(
    (groceryItems ?? []).map((row) => [row.id, Number(row.stockQuantity ?? 0)]),
  );
  for (const item of items) {
    const current = stockById.get(item.id);
    if (current === undefined) continue;
    if (current < item.quantity) {
      throw new HttpError(400, `${item.name} only has ${current} in stock`);
    }
    await prisma.groceryItem.update({
      where: { id: item.id },
      data: { stockQuantity: current - item.quantity },
    });
  }
}

function verifyDeliveryPin(order, providedPin) {
  const expected = order?.delivery_pin;
  if (!expected) return;
  const pin = cleanText(providedPin);
  if (pin !== expected) {
    throw new HttpError(400, "Invalid delivery PIN");
  }
}

function verifyStatusAdvance(flow, currentStatus, nextStatus) {
  try {
    assertStatusAdvance(flow, currentStatus, nextStatus);
  } catch {
    throw new HttpError(400, "Invalid status transition");
  }
}

async function writeAudit(token, actorId, action, targetType, targetId, message, metadata = {}) {
  try {
    await prisma.auditEvent.create({
      data: {
        actorId,
        action,
        targetType,
        targetId,
        message,
        metadata: metadata || {},
      },
    });
  } catch (error) {
    console.warn(`Audit event failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function normalizeAuthPurpose(value) {
  if (value === "register") return "register";
  if (value === "reset_password") return "reset_password";
  return "login";
}

function maskPhoneHint(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `••••${digits.slice(-4)}`;
}

async function resolveAccountForPasswordReset(email) {
  const user = await findUserByEmail(email);
  if (!user?.id) return null;

  const profile = await prisma.profile.findUnique({
    where: { id: user.id },
    select: { phone: true },
  });
  const profilePhone = typeof profile?.phone === "string" ? profile.phone.trim() : "";
  const metadataPhone =
    typeof user?.user_metadata?.phone === "string" ? user.user_metadata.phone.trim() : "";
  const authPhone = typeof user?.phone === "string" ? user.phone.trim() : "";
  const phone = profilePhone || metadataPhone || authPhone;

  return {
    userId: user.id,
    email: user.email?.toLowerCase() ?? email,
    phone: phone || null,
  };
}

async function resolveEmailForPhone(phone) {
  const profile = await prisma.profile.findFirst({
    where: { phone },
    select: { id: true },
  });

  if (!profile) return null;

  return findUserEmailByPhone(phone);
}

async function assertPhoneAvailable(phone) {
  const count = await prisma.profile.count({
    where: { phone },
  });
  if (count > 0) {
    throw new HttpError(409, "This phone number is already registered");
  }
}

async function assertEmailAvailable(email) {
  const existingUser = await findUserByEmail(email);
  if (existingUser?.id) {
    throw new HttpError(409, "This email address is already registered");
  }
}

async function completeUserRegistration({
  email,
  fullName,
  password,
  phone,
  phoneVerificationToken,
  requestedRole,
  businessName,
  roleMessage,
}) {
  verifyPhoneVerificationToken(phoneVerificationToken, phone);
  await assertEmailAvailable(email);
  await assertPhoneAvailable(phone);

  const role = "customer";
  let createdUserId = null;
  let emailVerificationRequired = env.authRequireEmailVerification;

  if (env.authRequireEmailVerification) {
    const signup = await signUpWithPassword(email, password, fullName, {
      role,
      phone,
      requested_role: requestedRole,
    });
    createdUserId = signup?.user?.id ?? signup?.id ?? null;
    if (!createdUserId) {
      throw new HttpError(500, "Account was created but no user id was returned");
    }
  } else {
    const createdUser = await createConfirmedUserWithPassword(email, password, fullName, {
      role,
      phone,
      requested_role: requestedRole,
    });
    createdUserId = createdUser?.id ?? createdUser?.user?.id;
    emailVerificationRequired = false;
    if (!createdUserId) {
      throw new HttpError(500, "Account was created but no user id was returned");
    }
  }

  await prisma.profile.upsert({
    where: { id: createdUserId },
    update: { fullName, phone },
    create: { id: createdUserId, fullName, phone },
  });

  await prisma.userRole.upsert({
    where: { userId_role: { userId: createdUserId, role } },
    update: {},
    create: { userId: createdUserId, role },
  });

  let roleRequestPending = false;
  let roleRequestWarning = null;

  if (requestedRole) {
    try {
      await prisma.roleRequest.create({
        data: {
          userId: createdUserId,
          requestedRole,
          businessName: cleanText(businessName) || null,
          message: cleanText(roleMessage) || "Requested during registration",
        },
      });
      roleRequestPending = true;
    } catch (error) {
      if (!isMissingTableError(error, "role_requests")) throw error;
      roleRequestWarning =
        "Account created, but role request storage is not available. Apply the latest Supabase migrations.";
      console.warn(`Role request skipped: ${error.message}`);
    }
  }

  if (emailVerificationRequired) {
    return {
      user: { id: createdUserId, email },
      roles: [role],
      authenticated: false,
      emailVerificationRequired: true,
      roleRequestPending,
      roleRequestWarning,
    };
  }

  const session = await signInWithPassword({ email }, password);
  const normalized = normalizeAuthSession(session);
  const roles =
    normalized.accessToken && normalized.user
      ? await getRoles(normalized.user.id)
      : [role];

  return {
    user: normalized.user,
    roles,
    authenticated: Boolean(normalized.accessToken),
    emailVerificationRequired: false,
    roleRequestPending,
    roleRequestWarning,
    __responseHeaders: {
      "Set-Cookie": buildSessionCookies(session),
    },
  };
}

function normalizeAuthSession(payload) {
  const session = payload?.session ?? payload;

  return {
    accessToken: session?.access_token ?? null,
    refreshToken: session?.refresh_token ?? null,
    expiresIn: Number(session?.expires_in ?? 3600),
    user: payload?.user ?? session?.user ?? null,
  };
}

function buildSessionCookies(payload) {
  const session = normalizeAuthSession(payload);

  if (!session.accessToken || !session.refreshToken) {
    return [];
  }

  return [
    serializeCookie(ACCESS_COOKIE, session.accessToken, {
      maxAge: session.expiresIn,
      path: "/",
      sameSite: "Lax",
      secure: env.cookieSecure,
    }),
    serializeCookie(REFRESH_COOKIE, session.refreshToken, {
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "Lax",
      secure: env.cookieSecure,
    }),
  ];
}

function clearSessionCookies() {
  return [
    serializeCookie(ACCESS_COOKIE, "", {
      maxAge: 0,
      path: "/",
      sameSite: "Lax",
      secure: env.cookieSecure,
    }),
    serializeCookie(REFRESH_COOKIE, "", {
      maxAge: 0,
      path: "/",
      sameSite: "Lax",
      secure: env.cookieSecure,
    }),
  ];
}

function mergeResponseHeaders(...headerSets) {
  const merged = {};
  const cookies = [];

  for (const headers of headerSets) {
    if (!headers) continue;

    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      if (key.toLowerCase() === "set-cookie") {
        if (Array.isArray(value)) cookies.push(...value);
        else cookies.push(value);
        continue;
      }
      merged[key] = value;
    }
  }

  if (cookies.length > 0) {
    merged["Set-Cookie"] = cookies;
  }

  return merged;
}

let serverEntryPromise;

async function getServerEntry() {
  if (!serverEntryPromise) {
    serverEntryPromise = import(frontendServerEntryPath).then(async (mod) =>
      mod.createServerEntry(mod.default),
    );
  }

  return serverEntryPromise;
}

async function getRoles(userId) {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    select: { role: true },
  });
  return (roles ?? []).map((r) => r.role);
}

async function jsonBody(req) {
  return readJson(req);
}

async function requestContext(req) {
  const bearerToken = getBearerToken(req);
  if (bearerToken) {
    const user = await getUserFromToken(bearerToken);
    return { token: bearerToken, user, responseHeaders: {} };
  }

  const cookies = parseCookies(req);
  let accessToken = cookies[ACCESS_COOKIE];
  const refreshToken = cookies[REFRESH_COOKIE];

  if (!accessToken && !refreshToken) {
    throw new HttpError(401, "Please sign in to continue");
  }

  try {
    if (!accessToken) throw new HttpError(401, "Missing access token");
    const user = await getUserFromToken(accessToken);
    return { token: accessToken, user, responseHeaders: {} };
  } catch (error) {
    if (!refreshToken) {
      throw error instanceof HttpError ? error : new HttpError(401, "Please sign in to continue");
    }

    try {
      const refreshed = await refreshAuthSession(refreshToken);
      const refreshedSession = normalizeAuthSession(refreshed);
      accessToken = refreshedSession.accessToken;

      if (!accessToken || !refreshedSession.user) {
        throw new HttpError(401, "Please sign in to continue");
      }

      return {
        token: accessToken,
        user: refreshedSession.user,
        responseHeaders: {
          "Set-Cookie": buildSessionCookies(refreshed),
        },
      };
    } catch {
      throw new HttpError(401, "Please sign in to continue");
    }
  }
}

function route(method, pattern, handler) {
  return { method, pattern, handler };
}

const routes = [
  route("GET", /^\/api\/health$/, async () => ({ ok: true, timestamp: new Date().toISOString() })),
  route("GET", /^\/api\/admin\/health$/, async ({ user }) => {
    const roles = await getRoles(user.id);
    if (!roles.includes("admin")) throw new HttpError(403, "Forbidden");
    const [pendingRoles, foodPending, groceryPending, unassignedFood] = await Promise.all([
      prisma.roleRequest.count({ where: { status: "pending" } }),
      prisma.foodOrder.count({ where: { status: { in: ["pending", "accepted", "preparing"] }, deliveryBoyId: null } }),
      prisma.groceryOrder.count({ where: { status: { in: ["pending", "accepted", "preparing"] }, deliveryBoyId: null } }),
      prisma.foodOrder.count({ where: { status: "ready", deliveryBoyId: null } }),
    ]);
    return { pendingRoleRequests: pendingRoles, foodOrdersNeedingAttention: foodPending, groceryOrdersNeedingAttention: groceryPending, readyFoodWithoutRider: unassignedFood };
  }),
  route("POST", /^\/api\/auth\/phone\/send-otp$/, async ({ body }) => {
    const phone = normalizeIndianPhone(body.phone);
    if (!phone || !/^\+\d{10,15}$/.test(phone)) throw new HttpError(400, "Invalid phone");
    const purpose = normalizeAuthPurpose(cleanText(body.purpose));
    if (purpose === "login") {
      const email = await resolveEmailForPhone(phone);
      if (!email) throw new HttpError(404, "No account found");
    } else if (purpose === "reset_password") {
      const email = cleanText(body.email)?.toLowerCase();
      const account = await resolveAccountForPasswordReset(email);
      if (!account?.phone || account.phone !== phone) throw new HttpError(400, "Invalid email/phone combination");
    } else {
      await assertPhoneAvailable(phone);
    }
    await sendPhoneVerificationCode(phone);
    return { ok: true, purpose, provider: "twilio" };
  }),
  route("POST", /^\/api\/auth\/phone\/verify-otp$/, async ({ body }) => {
    const phone = normalizeIndianPhone(body.phone);
    const code = cleanText(body.code);
    const purpose = normalizeAuthPurpose(cleanText(body.purpose));
    await verifyPhoneVerificationCode(phone, code);
    if (purpose === "register" || purpose === "reset_password") {
      return { ok: true, phoneVerificationToken: createPhoneVerificationToken(phone) };
    }
    const email = await resolveEmailForPhone(phone);
    if (!email) throw new HttpError(404, "No account found");
    const session = await createSessionForEmail(email);
    const normalized = normalizeAuthSession(session);
    const roles = await getRoles(normalized.user.id);
    return { user: normalized.user, roles, __responseHeaders: { "Set-Cookie": buildSessionCookies(session) } };
  }),
  route("POST", /^\/api\/auth\/password-reset\/request$/, async ({ body }) => {
    const email = cleanText(body.email)?.toLowerCase();
    const account = await resolveAccountForPasswordReset(email);
    if (account) await sendPasswordResetEmailOtp(account.email);
    return { ok: true, phoneHint: account?.phone ? maskPhoneHint(account.phone) : null };
  }),
  route("POST", /^\/api\/auth\/password-reset\/complete$/, async ({ body }) => {
    const email = cleanText(body.email)?.toLowerCase();
    const emailOtp = cleanText(body.email_otp);
    const phone = normalizeIndianPhone(body.phone);
    const phoneVerificationToken = cleanText(body.phone_verification_token);
    const password = typeof body.password === "string" ? body.password : "";
    const account = await resolveAccountForPasswordReset(email);
    if (!account || account.phone !== phone) throw new HttpError(400, "Invalid request");
    verifyPhoneVerificationToken(phoneVerificationToken, phone);
    verifyPasswordResetEmailOtp(email, emailOtp);
    await updateUserPassword(account.userId, password);
    const session = await createSessionForEmail(account.email);
    const normalized = normalizeAuthSession(session);
    const roles = await getRoles(normalized.user.id);
    return { ok: true, user: normalized.user, roles, __responseHeaders: { "Set-Cookie": buildSessionCookies(session) } };
  }),
  route("POST", /^\/api\/auth\/email\/resend-verification$/, async ({ body }) => {
    const email = cleanText(body.email)?.toLowerCase();
    await resendSignupConfirmation(email);
    return { ok: true };
  }),
  route("POST", /^\/api\/auth\/login$/, async ({ body }) => {
    const email = cleanText(body.email);
    const phone = normalizeIndianPhone(body.phone);
    let identifier = { email };
    if (phone) {
      const resolvedEmail = await resolveEmailForPhone(phone);
      if (!resolvedEmail) throw new HttpError(404, "No account found");
      identifier = { email: resolvedEmail };
    }
    const session = await signInWithPassword(identifier, body.password);
    const normalized = normalizeAuthSession(session);
    const roles = await getRoles(normalized.user.id);
    return { user: normalized.user, roles, __responseHeaders: { "Set-Cookie": buildSessionCookies(session) } };
  }),
  route("POST", /^\/api\/auth\/register$/, async ({ body }) => {
    const { email, fullName, password, phone } = validateRegistration(body);
    const requestedRole = normalizeBusinessRole(body.requested_role);
    const phoneVerificationToken = cleanText(body.phone_verification_token);
    return completeUserRegistration({ email, fullName, password, phone, phoneVerificationToken, requestedRole, businessName: body.business_name, roleMessage: body.role_message });
  }),
  route("POST", /^\/api\/auth\/logout$/, async ({ req }) => {
    const bearerToken = getBearerToken(req);
    const cookies = parseCookies(req);
    const accessToken = bearerToken || cookies[ACCESS_COOKIE];
    if (accessToken) await revokeSession(accessToken);
    return { ok: true, __responseHeaders: { "Set-Cookie": clearSessionCookies() } };
  }),
  route("GET", /^\/api\/auth\/me$/, async ({ user }) => {
    const roles = await getRoles(user.id);
    return { user, roles };
  }),
  route("POST", /^\/api\/auth\/push-token$/, async ({ user, body }) => {
    const token = trimToken(body.token);
    const platform = cleanText(body.platform) || "web";
    const deviceLabel = cleanText(body.device_label);
    if (!token) throw new HttpError(400, "Token required");
    const pushToken = await prisma.userPushToken.upsert({
      where: { token },
      update: { userId: user.id, platform, deviceLabel, updatedAt: new Date() },
      create: { userId: user.id, token, platform, deviceLabel, updatedAt: new Date() },
    });
    return { pushToken: { ...pushToken, user_id: pushToken.userId, device_label: pushToken.deviceLabel, updated_at: pushToken.updatedAt } };
  }),
  route("GET", /^\/api\/map\/route$/, async ({ url }) => {
    const fromLat = url.searchParams.get("fromLat");
    const fromLng = url.searchParams.get("fromLng");
    const toLat = url.searchParams.get("toLat");
    const toLng = url.searchParams.get("toLng");
    if (!fromLat || !fromLng || !toLat || !toLng) throw new HttpError(400, "Missing coords");
    if (!env.mapboxAccessToken) throw new HttpError(500, "Mapbox token missing");
    const mapboxUrl = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}`);
    mapboxUrl.searchParams.set("geometries", "geojson");
    mapboxUrl.searchParams.set("overview", "full");
    mapboxUrl.searchParams.set("access_token", env.mapboxAccessToken);
    const response = await fetch(mapboxUrl);
    const payload = await response.json();
    if (!response.ok) throw new HttpError(502, "Failed to fetch route");
    const coords = payload?.routes?.[0]?.geometry?.coordinates ?? [];
    return { route: coords.map(([lng, lat]) => ({ lat, lng })) };
  }),
  route("GET", /^\/api\/profile$/, async ({ user }) => {
    const profile = await prisma.profile.findUnique({ where: { id: user.id } });
    return { profile: { ...profile, full_name: profile.fullName, avatar_url: profile.avatarUrl, town_name: profile.townName, created_at: profile.createdAt, updated_at: profile.updatedAt } };
  }),
  route("PATCH", /^\/api\/profile$/, async ({ user, body }) => {
    const profile = await prisma.profile.update({
      where: { id: user.id },
      data: { fullName: body.full_name ?? "", phone: body.phone ?? "" },
    });
    return { profile: { ...profile, full_name: profile.fullName, avatar_url: profile.avatarUrl, town_name: profile.townName, created_at: profile.createdAt, updated_at: profile.updatedAt } };
  }),
  route("GET", /^\/api\/profile\/addresses$/, async ({ user }) => {
    const addresses = await prisma.savedAddress.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
    return { addresses };
  }),
  route("POST", /^\/api\/profile\/addresses$/, async ({ user, body }) => {
    const address = await prisma.savedAddress.create({
      data: { userId: user.id, label: requireText(body.label || "Saved", "Label"), address: requireText(body.address, "Address"), lat: body.lat ? Number(body.lat) : null, lng: body.lng ? Number(body.lng) : null, isDefault: !!body.is_default },
    });
    return { address };
  }),
  route("DELETE", /^\/api\/profile\/addresses\/([^/]+)$/, async ({ match }) => {
    await prisma.savedAddress.delete({ where: { id: decodeURIComponent(match[1]) } });
    return { ok: true };
  }),
  route("GET", /^\/api\/profile\/role-requests$/, async ({ user }) => {
    const requests = await prisma.roleRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    return { requests: requests.map(r => ({ ...r, user_id: r.userId, requested_role: r.requestedRole, business_name: r.businessName, created_at: r.createdAt })) };
  }),
  route("POST", /^\/api\/profile\/role-requests$/, async ({ user, body }) => {
    const request = await prisma.roleRequest.create({
      data: { userId: user.id, requestedRole: normalizeBusinessRole(body.requested_role), businessName: body.business_name || null, message: body.message || null },
    });
    return { request: { ...request, user_id: request.userId, requested_role: request.requestedRole, business_name: request.businessName, created_at: request.createdAt } };
  }),
  route("PATCH", /^\/api\/tracking\/location$/, async ({ body }) => {
    const modelName = body.table.replace(/_([a-z])/g, (g) => g[1].toUpperCase()).slice(0, -1).replace(/ies$/, "y");
    const row = await prisma[modelName].update({
      where: { id: body.row_id },
      data: { riderLat: body.rider_lat, riderLng: body.rider_lng, riderLocationUpdatedAt: new Date() },
    });
    return { row: { ...row, rider_lat: row.riderLat, rider_lng: row.riderLng, rider_location_updated_at: row.riderLocationUpdatedAt } };
  }),
  route("GET", /^\/api\/catalog\/restaurants$/, async () => {
    const restaurants = await prisma.restaurant.findMany({ orderBy: { createdAt: "desc" } });
    return { restaurants: restaurants.map(r => ({ ...r, town_name: r.townName, is_open: r.isOpen, created_at: r.createdAt })) };
  }),
  route("GET", /^\/api\/catalog\/restaurants\/([^/]+)$/, async ({ match }) => {
    const id = decodeURIComponent(match[1]);
    const [restaurant, items] = await Promise.all([
      prisma.restaurant.findUnique({ where: { id } }),
      prisma.menuItem.findMany({ where: { restaurantId: id, isAvailable: true }, orderBy: { category: "asc" } }),
    ]);
    const normalizedRestaurant = restaurant ? { ...restaurant, town_name: restaurant.townName, is_open: restaurant.isOpen, created_at: restaurant.createdAt } : null;
    const normalizedItems = items.map(i => ({ ...i, restaurant_id: i.restaurantId, is_available: i.isAvailable, is_veg: i.isVeg }));
    return { restaurant: normalizedRestaurant, items: normalizedItems };
  }),
  route("GET", /^\/api\/catalog\/featured-food$/, async () => {
    const restaurants = await prisma.restaurant.findMany({ where: { isOpen: true }, select: { id: true } });
    const restaurantIds = restaurants.map(r => r.id);
    if (!restaurantIds.length) return { items: [] };
    const items = await prisma.menuItem.findMany({ where: { isAvailable: true, restaurantId: { in: restaurantIds } }, include: { restaurant: { select: { name: true } } }, take: 12 });
    return { items: items.map(i => ({ ...i, image_url: i.imageUrl, is_available: i.isAvailable, restaurant_id: i.restaurantId, restaurants: i.restaurant })) };
  }),
  route("GET", /^\/api\/catalog\/featured-grocery$/, async () => {
    const stores = await prisma.groceryStore.findMany({ where: { isOpen: true }, select: { id: true } });
    const storeIds = stores.map(s => s.id);
    if (!storeIds.length) return { items: [] };
    const items = await prisma.groceryItem.findMany({ where: { isAvailable: true, storeId: { in: storeIds } }, include: { store: { select: { name: true } } }, take: 12 });
    return { items: items.map(i => ({ ...i, image_url: i.imageUrl, is_available: i.isAvailable, store_id: i.storeId, grocery_stores: i.store })) };
  }),
  route("GET", /^\/api\/catalog\/stores$/, async () => {
    const stores = await prisma.groceryStore.findMany({ orderBy: { createdAt: "desc" } });
    return { stores: stores.map(s => ({ ...s, town_name: s.townName, is_open: s.isOpen })) };
  }),
  route("GET", /^\/api\/catalog\/stores\/([^/]+)$/, async ({ match }) => {
    const id = decodeURIComponent(match[1]);
    const [store, items] = await Promise.all([
      prisma.groceryStore.findUnique({ where: { id } }),
      prisma.groceryItem.findMany({ where: { storeId: id, isAvailable: true }, orderBy: { category: "asc" } }),
    ]);
    const normalizedStore = store ? { ...store, town_name: store.townName, is_open: store.isOpen } : null;
    const normalizedItems = items.map(i => ({ ...i, store_id: i.storeId, is_available: i.isAvailable }));
    return { store: normalizedStore, items: normalizedItems };
  }),
  route("POST", /^\/api\/orders\/food$/, async ({ user, body }) => {
    const items = validateCartItems(body.items);
    const restaurant = await prisma.restaurant.findUnique({ where: { id: body.restaurant_id } });
    if (!restaurant || !restaurant.isOpen) throw new HttpError(400, "Restaurant not available");
    const menuItems = await prisma.menuItem.findMany({ where: { restaurantId: body.restaurant_id, id: { in: items.map(i => i.id) } } });
    const menuById = new Map(menuItems.map(m => [m.id, m]));
    let total = 0;
    let maxPrep = 0;
    for (const item of items) {
      const m = menuById.get(item.id);
      if (!m || !m.isAvailable || Number(m.price) !== item.price) throw new HttpError(400, `Item ${item.name} changed`);
      total += item.price * item.quantity;
      maxPrep = Math.max(maxPrep, m.prepTimeMinutes || 15);
    }
    const order = await prisma.foodOrder.create({
      data: {
        customerId: user.id, restaurantId: body.restaurant_id, deliveryAddress: body.delivery_address, total, paymentMethod: body.payment_method || "cash",
        deliveryPin: generateDeliveryPin(), estimatedDeliveryAt: estimateDeliveryAt(maxPrep, { lat: body.lat, lng: body.lng }, { lat: restaurant.lat, lng: restaurant.lng }, distanceKm),
        items: { create: items.map(i => ({ menuItemId: i.id, name: i.name, price: i.price, quantity: i.quantity })) }
      }
    });
    return { order };
  }),
  route("POST", /^\/api\/orders\/grocery$/, async ({ user, body }) => {
    const items = validateCartItems(body.items);
    const store = await prisma.groceryStore.findUnique({ where: { id: body.store_id } });
    if (!store || !store.isOpen) throw new HttpError(400, "Store not available");
    const groceryItems = await prisma.groceryItem.findMany({ where: { storeId: body.store_id, id: { in: items.map(i => i.id) } } });
    const groceryById = new Map(groceryItems.map(m => [m.id, m]));
    let total = 0;
    for (const item of items) {
      const m = groceryById.get(item.id);
      if (!m || !m.isAvailable || Number(m.price) !== item.price) throw new HttpError(400, `Item ${item.name} changed`);
      if (m.stockQuantity < item.quantity) throw new HttpError(400, `Item ${item.name} out of stock`);
      total += item.price * item.quantity;
    }
    const order = await prisma.groceryOrder.create({
      data: {
        customerId: user.id, storeId: body.store_id, deliveryAddress: body.delivery_address, total, paymentMethod: body.payment_method || "cash",
        deliveryPin: generateDeliveryPin(), estimatedDeliveryAt: estimateDeliveryAt(15, { lat: body.lat, lng: body.lng }, { lat: store.lat, lng: store.lng }, distanceKm),
        items: { create: items.map(i => ({ groceryItemId: i.id, name: i.name, price: i.price, quantity: i.quantity })) }
      }
    });
    await deductGroceryStock(body.store_id, items);
    return { order };
  }),
  route("GET", /^\/api\/orders\/history$/, async ({ user }) => {
    const [food, grocery, rides, packages] = await Promise.all([
      prisma.foodOrder.findMany({ where: { customerId: user.id }, include: { restaurant: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
      prisma.groceryOrder.findMany({ where: { customerId: user.id }, include: { store: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
      prisma.ride.findMany({ where: { customerId: user.id }, orderBy: { createdAt: "desc" } }),
      prisma.packageDelivery.findMany({ where: { customerId: user.id }, orderBy: { createdAt: "desc" } }),
    ]);
    return {
      food: food.map(f => ({ ...f, delivery_address: f.deliveryAddress, rider_id: f.deliveryBoyId, restaurants: f.restaurant })),
      grocery: grocery.map(g => ({ ...g, delivery_address: g.deliveryAddress, rider_id: g.deliveryBoyId, grocery_stores: g.store })),
      rides, packages
    };
  }),
  route("POST", /^\/api\/orders\/cancel$/, async ({ user, body }) => {
    const { id, kind } = body;
    const modelName = { ride: "ride", package: "packageDelivery", food: "foodOrder", grocery: "groceryOrder" }[kind];
    const current = await prisma[modelName].findFirst({ where: { id, customerId: user.id } });
    assertCancellable(current, kind);
    const row = await prisma[modelName].update({
      where: { id }, data: { status: "cancelled", cancellationReason: body.reason || "Customer cancelled", cancelledAt: new Date() }
    });
    return { row };
  }),
  route("GET", /^\/api\/track\/(ride|package|food|grocery)\/([^/]+)$/, async ({ match }) => {
    const kind = match[1];
    const id = decodeURIComponent(match[2]);
    const modelName = { ride: "ride", package: "packageDelivery", food: "foodOrder", grocery: "groceryOrder" }[kind];
    const row = await prisma[modelName].findUnique({ where: { id } });
    let partner = null;
    const riderId = row?.riderId || row?.deliveryBoyId;
    if (riderId) partner = await prisma.profile.findUnique({ where: { id: riderId }, select: { id: true, fullName: true, phone: true } });
    return { row: { ...row, rider_id: riderId, partner: partner ? { ...partner, full_name: partner.fullName } : null } };
  }),
  route("GET", /^\/api\/chat\/(ride|package|food|grocery)\/([^/]+)$/, async ({ user, match }) => {
    const kind = match[1];
    const serviceId = decodeURIComponent(match[2]);
    const context = await getChatContext(user, kind, serviceId);
    const messages = await prisma.chatMessage.findMany({ where: { serviceKind: context.kind, serviceId }, orderBy: { createdAt: "asc" }, take: 100 });
    return { messages: messages.map(m => ({ ...m, sender_id: m.senderId, created_at: m.createdAt })), participant: { customer_id: context.row.customer_id, partner_id: context.row[context.partnerColumn] || null } };
  }),
  route("POST", /^\/api\/chat\/(ride|package|food|grocery)\/([^/]+)$/, async ({ user, body, match }) => {
    const kind = match[1];
    const serviceId = decodeURIComponent(match[2]);
    const context = await getChatContext(user, kind, serviceId);
    const saved = await prisma.chatMessage.create({ data: { serviceKind: kind, serviceId, senderId: user.id, body: requireText(body.message, "Message", 1000) } });
    void notifyChatRecipients({ senderId: user.id, context, kind, serviceId, messageBody: body.message });
    return { message: { ...saved, sender_id: saved.senderId, created_at: saved.createdAt } };
  }),
  route("POST", /^\/api\/rides$/, async ({ user, body }) => {
    const ride = await prisma.ride.create({
      data: {
        customerId: user.id, pickupLat: body.pickup_lat, pickupLng: body.pickup_lng, pickupAddress: body.pickup_address,
        dropLat: body.drop_lat, dropLng: body.drop_lng, dropAddress: body.drop_address, fareEstimate: body.fare_estimate,
        vehicleType: body.vehicle_type, notes: body.notes, paymentMethod: body.payment_method || "cash",
        deliveryPin: generateDeliveryPin(), estimatedArrivalAt: estimateDeliveryAt(5, { lat: body.pickup_lat, lng: body.pickup_lng }, { lat: body.drop_lat, lng: body.drop_lng }, distanceKm)
      }
    });
    return { ride };
  }),
  route("POST", /^\/api\/packages$/, async ({ user, body }) => {
    const pkg = await prisma.packageDelivery.create({
      data: {
        customerId: user.id, pickupLat: body.pickup_lat, pickupLng: body.pickup_lng, pickupAddress: body.pickup_address,
        dropLat: body.drop_lat, dropLng: body.drop_lng, dropAddress: body.drop_address, fareEstimate: body.fare_estimate,
        packageSize: body.package_size, receiverName: body.receiver_name, receiverPhone: body.receiver_phone,
        notes: body.notes, paymentMethod: body.payment_method || "cash", deliveryPin: generateDeliveryPin(),
        estimatedDeliveryAt: estimateDeliveryAt(10, { lat: body.pickup_lat, lng: body.pickup_lng }, { lat: body.drop_lat, lng: body.drop_lng }, distanceKm)
      }
    });
    return { packageDelivery: pkg };
  }),
  route("GET", /^\/api\/admin\/analytics$/, async ({ user }) => {
    const roles = await getRoles(user.id);
    if (!roles.includes("admin")) throw new HttpError(403, "Forbidden");
    const [users, restaurants, stores, foodOrders, groceryOrders, rides, packages] = await Promise.all([
      prisma.profile.count(), prisma.restaurant.count(), prisma.groceryStore.count(),
      prisma.foodOrder.count(), prisma.groceryOrder.count(), prisma.ride.count(), prisma.packageDelivery.count()
    ]);
    return { users, restaurants, stores, foodOrders, groceryOrders, rides, packages };
  }),
  route("POST", /^\/api\/admin\/restaurants$/, async ({ user, body }) => {
    const roles = await getRoles(user.id);
    if (!roles.includes("admin")) throw new HttpError(403, "Forbidden");
    const r = await prisma.restaurant.create({ data: body });
    return { restaurant: r };
  }),
  route("PUT", /^\/api\/admin\/restaurants\/([^/]+)$/, async ({ user, match, body }) => {
    const roles = await getRoles(user.id);
    if (!roles.includes("admin")) throw new HttpError(403, "Forbidden");
    const r = await prisma.restaurant.update({ where: { id: decodeURIComponent(match[1]) }, data: body });
    return { restaurant: r };
  }),
  route("POST", /^\/api\/admin\/restaurants\/([^/]+)\/toggle$/, async ({ user, match, body }) => {
    const roles = await getRoles(user.id);
    if (!roles.includes("admin")) throw new HttpError(403, "Forbidden");
    const r = await prisma.restaurant.update({ where: { id: decodeURIComponent(match[1]) }, data: { isOpen: !!body.is_open } });
    return { restaurant: r };
  }),
  route("POST", /^\/api\/admin\/role-requests\/([^/]+)\/decide$/, async ({ user, match, body }) => {
    const roles = await getRoles(user.id);
    if (!roles.includes("admin")) throw new HttpError(403, "Forbidden");
    const requestId = decodeURIComponent(match[1]);
    const request = await prisma.roleRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new HttpError(404, "Not found");
    if (body.decision === "approved") {
      await prisma.userRole.upsert({ where: { userId_role: { userId: request.userId, role: request.requestedRole } }, update: {}, create: { userId: request.userId, role: request.requestedRole } });
    }
    const updated = await prisma.roleRequest.update({ where: { id: requestId }, data: { status: body.decision, reviewedBy: user.id, reviewedAt: new Date() } });
    return { request: updated };
  }),
  route("GET", /^\/api\/hotel\/dashboard$/, async ({ user }) => {
    const restaurant = await prisma.restaurant.findFirst({ where: { managerId: user.id } });
    if (!restaurant) return { restaurant: null };
    const stats = {
      total: await prisma.foodOrder.count({ where: { restaurantId: restaurant.id } }),
      pending: await prisma.foodOrder.count({ where: { restaurantId: restaurant.id, status: { in: ["pending", "accepted", "preparing"] } } }),
      today: await prisma.foodOrder.count({ where: { restaurantId: restaurant.id, createdAt: { gte: startOfLocalDay() } } })
    };
    return { restaurant, stats };
  }),
  route("POST", /^\/api\/hotel\/orders\/([^/]+)\/advance$/, async ({ user, match, body }) => {
    const restaurant = await prisma.restaurant.findFirst({ where: { managerId: user.id } });
    const order = await prisma.foodOrder.update({ where: { id: decodeURIComponent(match[1]), restaurantId: restaurant.id }, data: { status: body.status } });
    return { order };
  }),
  route("GET", /^\/api\/delivery\/available$/, async () => {
    const food = await prisma.foodOrder.findMany({ where: { deliveryBoyId: null, status: { in: ["ready", "preparing"] } }, include: { restaurant: true } });
    const grocery = await prisma.groceryOrder.findMany({ where: { deliveryBoyId: null, status: { in: ["ready", "preparing"] } }, include: { store: true } });
    return { food, grocery };
  }),
  route("POST", /^\/api\/delivery\/(food|grocery)\/([^/]+)\/accept$/, async ({ user, match }) => {
    const modelName = match[1] === "food" ? "foodOrder" : "groceryOrder";
    const order = await prisma[modelName].update({ where: { id: decodeURIComponent(match[2]), deliveryBoyId: null }, data: { deliveryBoyId: user.id, status: "accepted" } });
    return { order };
  }),
  route("POST", /^\/api\/delivery\/(food|grocery)\/([^/]+)\/advance$/, async ({ user, match, body }) => {
    const modelName = match[1] === "food" ? "foodOrder" : "groceryOrder";
    const order = await prisma[modelName].update({ where: { id: decodeURIComponent(match[2]), deliveryBoyId: user.id }, data: { status: body.status, paymentStatus: body.status === "delivered" ? "paid" : undefined } });
    return { order };
  }),
  route("GET", /^\/api\/rider\/jobs$/, async ({ user }) => {
    const rides = await prisma.ride.findMany({ where: { OR: [{ riderId: null }, { riderId: user.id }], NOT: { status: { in: ["completed", "cancelled"] } } } });
    const packages = await prisma.packageDelivery.findMany({ where: { OR: [{ riderId: null }, { riderId: user.id }], NOT: { status: { in: ["completed", "cancelled"] } } } });
    return { rides, packages };
  }),
  route("POST", /^\/api\/rider\/(rides|package_deliveries)\/([^/]+)\/accept$/, async ({ user, match }) => {
    const modelName = match[1] === "rides" ? "ride" : "packageDelivery";
    const job = await prisma[modelName].update({ where: { id: decodeURIComponent(match[2]), riderId: null }, data: { riderId: user.id, status: "accepted" } });
    return { job };
  }),
  route("POST", /^\/api\/rider\/(rides|package_deliveries)\/([^/]+)\/advance$/, async ({ user, match, body }) => {
    const modelName = match[1] === "rides" ? "ride" : "packageDelivery";
    const job = await prisma[modelName].update({ where: { id: decodeURIComponent(match[2]), riderId: user.id }, data: { status: body.status } });
    return { job };
  }),
  route("GET", /^\/api\/admin\/commissions$/, async () => ({ commissions: await getPlatformCommissions() })),
  route("PUT", /^\/api\/admin\/commissions$/, async ({ body }) => ({ commissions: await savePlatformCommissions(body) })),
  route("POST", /^\/api\/reviews$/, async ({ user, body }) => {
    const review = await prisma.orderReview.create({ data: { userId: user.id, serviceKind: body.service_kind, serviceId: body.service_id, rating: body.rating, comment: sanitizeComment(body.comment) } });
    return { review };
  }),
  route("GET", /^\/api\/reviews\/([^/]+)\/([^/]+)$/, async ({ match }) => {
    const reviews = await prisma.orderReview.findMany({ where: { serviceKind: match[1], serviceId: decodeURIComponent(match[2]) }, orderBy: { createdAt: "desc" }, take: 20 });
    return { reviews };
  }),
];
async function matchApiRoute(req, url) {
  for (const entry of routes) {
    if (entry.method !== req.method) continue;
    const match = url.pathname.match(entry.pattern);
    if (!match) continue;
    return { entry, match };
  }

  return null;
}

function resolveCorsOrigin(requestOrigin) {
  if (env.corsAllowAll) return requestOrigin || "*";
  if (requestOrigin && env.corsAllowedOrigins.includes(requestOrigin)) return requestOrigin;
  return "null";
}

function corsHeadersForRequest(req) {
  const resolvedOrigin = resolveCorsOrigin(req.headers.origin);
  const allowCredentials = resolvedOrigin !== "*" && resolvedOrigin !== "null";
  return getCorsHeaders(resolvedOrigin, allowCredentials);
}

async function handleApi(req, res, url) {
  const clientIp =
    cleanText(req.headers["x-forwarded-for"])?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  const rateMessage = checkRateLimit(clientIp, url.pathname);
  if (rateMessage) {
    throw new HttpError(429, rateMessage);
  }

  const matched = await matchApiRoute(req, url);
  if (!matched) {
    throw new HttpError(404, "API route not found");
  }

  const started = Date.now();
  const corsHeaders = corsHeadersForRequest(req);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const isPublic = isPublicApiRoute(req.method || "GET", url.pathname);
  const context = isPublic ? {} : await requestContext(req);
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await jsonBody(req) : {};

  const payload = await matched.entry.handler({
    req,
    res,
    url,
    body,
    match: matched.match,
    ...context,
  });

  const { __responseHeaders, ...safePayload } = payload ?? {};

  logEvent("info", "api_request", {
    method: req.method,
    path: url.pathname,
    userId: context.user?.id ?? "anon",
    durationMs: Date.now() - started,
  });

  sendJson(
    res,
    200,
    safePayload,
    mergeResponseHeaders(corsHeaders, context.responseHeaders, __responseHeaders),
  );
}

async function serveClientAsset(req, res, url) {
  let resolved = path.join(frontendClientDir, url.pathname);

  try {
    let stats = await fs.stat(resolved);
    if (stats.isDirectory()) {
      resolved = path.join(resolved, "index.html");
      stats = await fs.stat(resolved);
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const content = await fs.readFile(resolved);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": content.length,
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

async function requestToFetchRequest(req, url) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
      continue;
    }
    if (value !== undefined) headers.set(key, value);
  }

  const init = {
    method: req.method,
    headers,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (body.length > 0) {
      init.body = body;
      init.duplex = "half";
    }
  }

  return new Request(url, init);
}

async function serveSsr(req, res, url) {
  const entry = await getServerEntry();
  const request = await requestToFetchRequest(req, url.toString());
  const response = await entry.fetch(request);
  const buffer = Buffer.from(await response.arrayBuffer());
  const headers = {};

  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  res.writeHead(response.status, headers);
  res.end(buffer);
}

async function serveFrontend(req, res, url) {
  const isAssetRequest =
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/favicon.ico" ||
    path.extname(url.pathname) !== "";

  if (isAssetRequest) {
    const served = await serveClientAsset(req, res, url);
    if (served) return;
  }

  try {
    await fs.stat(frontendServerEntryPath);
    await serveSsr(req, res, url);
  } catch {
    sendText(
      res,
      200,
      "Frontend SSR build not found. Run `npm run build` and then start the backend.",
    );
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

  try {
    if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      res.writeHead(204, corsHeadersForRequest(req));
      res.end();
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    await serveFrontend(req, res, url);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected server error";
    const requestId = createRequestId();
    logRequestError(req, url, status, error, requestId);
    if (!(error instanceof HttpError)) {
      logEvent("error", "unexpected_exception", { stack: error instanceof Error ? error.stack : null });
    }

    const headers = url.pathname.startsWith("/api/")
      ? { ...corsHeadersForRequest(req), "X-Request-Id": requestId }
      : { "X-Request-Id": requestId };

    sendJson(res, status, { error: message, requestId }, headers);
  }
});

server.listen(env.port, env.host, () => {
  console.log(`Backend listening on http://${env.host}:${env.port}`);
});
