import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import serverless from "serverless-http";
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
import { prisma } from "./lib/prisma.mjs";
import { hashPassword, comparePassword, generateToken, verifyToken } from "./lib/auth.mjs";
import { checkRateLimit } from "./lib/rate-limit.mjs";
import {
  createPhoneVerificationToken,
  verifyPhoneVerificationToken,
} from "./lib/phone-verification.mjs";
import {
  loginSchema,
  phoneOtpSendSchema,
  phoneOtpVerifySchema,
  passwordResetRequestSchema,
  passwordResetCompleteSchema,
  registerSchema,
  addressSchema,
  profileUpdateSchema,
  reviewSchema,
  rideBookingSchema,
  packageBookingSchema,
} from "./lib/validation.mjs";
import { warmupBaileys } from "./lib/baileys.mjs";
import {
  sendWhatsAppOtp,
  verifyWhatsAppOtp,
} from "./lib/whatsapp-otp.mjs";
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
      select: { value: true }
    });
    return normalizeCatalogRadius(row?.value);
  } catch (error) {
    console.warn(`Catalog radius setting unavailable: ${error.message}`);
  }
  return DEFAULT_CATALOG_RADIUS_KM;
}

async function saveCatalogRadiusKm(radiusKm) {
  const value = normalizeCatalogRadius(radiusKm);
  const row = await prisma.platformSetting.upsert({
    where: { key: "catalog_radius_km" },
    update: { value, updated_at: new Date() },
    create: { key: "catalog_radius_km", value }
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
      select: { town_name: true, pincode: true }
    }),
    prisma.savedAddress.findFirst({
      where: { user_id: userId },
      orderBy: [{ is_default: "desc" }, { created_at: "desc" }],
      select: { lat: true, lng: true }
    }),
  ]);

  return {
    town_name: profile?.town_name ?? null,
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
  const modelName = {
    rides: "ride",
    package_deliveries: "packageDelivery",
    food_orders: "foodOrder",
    grocery_orders: "groceryOrder"
  }[target.table];

  const row = await prisma[modelName].findUnique({
    where: { id: serviceId },
    select: { id: true, customer_id: true, [target.partnerColumn]: true }
  });

  if (!row) {
    throw new HttpError(404, "Chat target not found");
  }

  if (isChatParticipant(user.id, row, target.partnerColumn)) {
    return { kind: normalizedKind, row, partnerColumn: target.partnerColumn };
  }

  const roles = await getRoles(user.id);
  if (!roles.includes("admin")) {
    throw new HttpError(403, "You do not have access to this chat");
  }

  return { kind: normalizedKind, row, partnerColumn: target.partnerColumn };
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

function getChatRecipientUserIds(context, senderId) {
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

async function getProfileDisplayName(userId) {
  const profile = await prisma.profile.findUnique({
    where: { id: userId },
    select: { full_name: true }
  });
  return cleanText(profile?.full_name) || "Someone";
}

async function getPushTokensForUsers(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const tokens = await prisma.userPushToken.findMany({
    where: { user_id: { in: uniqueIds } },
    orderBy: { updated_at: "desc" },
    take: 50,
    select: { token: true }
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
  const fullName = requireText(body.full_name, "Full name", 120);
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, "Password must include at least one letter and one number");
  }
  const phone = normalizeIndianPhone(body.phone);
  if (!/^\+\d{10,15}$/.test(phone)) {
    throw new HttpError(400, "Enter a valid phone number with country code");
  }

  return { fullName, password, phone };
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
      select: { value: true }
    });
    if (row?.value && typeof row.value === "object") {
      return { ...DEFAULT_COMMISSIONS, ...row.value };
    }
  } catch (error) {
    console.warn(`Commission settings unavailable: ${error.message}`);
  }
  return DEFAULT_COMMISSIONS;
}

async function savePlatformCommissions(value) {
  const row = await prisma.platformSetting.upsert({
    where: { key: "commissions" },
    update: { value, updated_at: new Date() },
    create: { key: "commissions", value }
  });
  return row?.value ?? value;
}

async function deductGroceryStock(storeId, items) {
  const groceryItems = await prisma.groceryItem.findMany({
    where: {
      store_id: storeId,
      id: { in: items.map((item) => item.id) }
    },
    select: { id: true, stock_quantity: true }
  });

  const stockById = new Map(
    (groceryItems ?? []).map((row) => [row.id, Number(row.stock_quantity ?? 0)]),
  );

  for (const item of items) {
    const current = stockById.get(item.id);
    if (current === undefined) continue;
    if (current < item.quantity) {
      throw new HttpError(400, `${item.name} only has ${current} in stock`);
    }
    await prisma.groceryItem.update({
      where: { id: item.id },
      data: { stock_quantity: current - item.quantity }
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

async function writeAudit(actorId, action, targetType, targetId, message, metadata = {}) {
  try {
    await prisma.auditEvent.create({
      data: {
        actor_id: actorId,
        action,
        target_type: targetType,
        target_id: targetId,
        message,
        metadata,
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

async function assertPhoneAvailable(phone) {
  const user = await prisma.user.findUnique({ where: { phone } });
  if (user) {
    throw new HttpError(409, "This phone number is already registered");
  }
}

// Removing completeUserRegistration as it is now inlined in /api/auth/register with Prisma

function buildSessionCookies(token) {
  if (!token) {
    return [];
  }

  return [
    serializeCookie(ACCESS_COOKIE, token, {
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
      sameSite: "Lax",
      secure: env.cookieSecure,
    })
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
    where: { user_id: userId },
    select: { role: true }
  });
  return roles.map((r) => r.role);
}

async function getProfileMap(ids) {
  const uniqueIds = [...new Set((ids ?? []).filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  try {
    const profiles = await prisma.profile.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, full_name: true, phone: true }
    });
    return new Map(profiles.map((profile) => [profile.id, profile]));
  } catch (error) {
    console.warn(`Profile lookup unavailable: ${error.message}`);
    return new Map();
  }
}

async function attachUserProfiles(rows, mappings) {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const ids = list.flatMap((row) => Object.values(mappings).map((column) => row?.[column]));
  const profileMap = await getProfileMap(ids);

  const hydrated = list.map((row) => {
    const profiles = {};
    for (const [key, column] of Object.entries(mappings)) {
      profiles[key] = profileMap.get(row?.[column]) ?? null;
    }

    return {
      ...row,
      ...profiles,
      profiles: profiles.customer ?? profiles.rider ?? row.profiles ?? null,
    };
  });

  return Array.isArray(rows) ? hydrated : (hydrated[0] ?? null);
}

async function jsonBody(req) {
  return readJson(req);
}

async function requestContext(req) {
  const bearerToken = getBearerToken(req);
  const cookies = parseCookies(req);
  const accessToken = bearerToken || cookies[ACCESS_COOKIE];

  if (!accessToken) {
    throw new HttpError(401, "Please sign in to continue");
  }

  const decoded = verifyToken(accessToken);
  if (!decoded || !decoded.id) {
    throw new HttpError(401, "Invalid or expired session");
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.id },
    select: { id: true, email: true, phone: true }
  });

  if (!user) {
    throw new HttpError(401, "User not found");
  }

  return { token: accessToken, user, responseHeaders: {} };
}

function route(method, pattern, handler) {
  return { method, pattern, handler };
}

const routes = [
  route("GET", /^\/api\/health$/, async () => ({ ok: true, timestamp: new Date().toISOString() })),
  route("GET", /^\/api\/admin\/health$/, async () => {
    const [pendingRoles, foodPending, groceryPending, unassignedFood] = await Promise.all([
      prisma.roleRequest.findMany({ where: { status: "pending" }, take: 50, select: { id: true } }),
      prisma.foodOrder.findMany({ where: { status: { in: ["pending", "accepted", "preparing"] }, delivery_boy_id: null }, take: 50, select: { id: true } }),
      prisma.groceryOrder.findMany({ where: { status: { in: ["pending", "accepted", "preparing"] }, delivery_boy_id: null }, take: 50, select: { id: true } }),
      prisma.foodOrder.findMany({ where: { status: "ready", delivery_boy_id: null }, take: 50, select: { id: true } }),
    ]);

    return {
      pendingRoleRequests: pendingRoles?.length ?? 0,
      foodOrdersNeedingAttention: foodPending?.length ?? 0,
      groceryOrdersNeedingAttention: groceryPending?.length ?? 0,
      readyFoodWithoutRider: unassignedFood?.length ?? 0,
    };
  }),
  route("POST", /^\/api\/auth\/phone\/send-otp$/, async ({ body }) => {
    const payload = {
      phone: normalizeIndianPhone(body.phone),
      purpose: cleanText(body.purpose),
    };
    const parsed = phoneOtpSendSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid inputs");
    }
    const { phone, purpose } = parsed.data;

    if (purpose === "login") {
      const user = await prisma.user.findUnique({ where: { phone } });
      if (!user) {
        throw new HttpError(404, "No account found for this phone number");
      }
    } else if (purpose === "reset_password") {
      const user = await prisma.user.findUnique({ where: { phone } });
      if (!user) {
        throw new HttpError(404, "No account found for this phone number");
      }
    } else {
      await assertPhoneAvailable(phone);
    }

    const result = await sendWhatsAppOtp(phone);

    return {
      ok: true,
      purpose,
      provider: "whatsapp",
      message: "Verification code sent to your WhatsApp",
    };
  }),
  route("POST", /^\/api\/auth\/phone\/verify-otp$/, async ({ body }) => {
    const payload = {
      phone: normalizeIndianPhone(body.phone),
      code: cleanText(body.code),
      purpose: cleanText(body.purpose),
    };
    const parsed = phoneOtpVerifySchema.safeParse(payload);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid inputs");
    }
    const { phone, code, purpose } = parsed.data;

    verifyWhatsAppOtp(phone, code);

    if (purpose === "register" || purpose === "reset_password") {
      return {
        ok: true,
        phoneVerificationToken: createPhoneVerificationToken(phone),
      };
    }

    const user = await prisma.user.findUnique({
      where: { phone },
      include: { roles: true }
    });
    if (!user) {
      throw new HttpError(404, "No account found for this phone number");
    }

    const token = generateToken(user);
    const roles = user.roles.map(r => r.role);

    return {
      user: { id: user.id, email: user.email, phone: user.phone },
      roles,
      __responseHeaders: {
        "Set-Cookie": buildSessionCookies(token),
      },
    };
  }),
  route("POST", /^\/api\/auth\/password-reset\/request$/, async ({ body }) => {
    const payload = {
      phone: normalizeIndianPhone(body.phone),
    };
    const parsed = passwordResetRequestSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid inputs");
    }
    const { phone } = parsed.data;

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      throw new HttpError(404, "No account found for this phone number");
    }

    await sendWhatsAppOtp(phone);

    return {
      ok: true,
      message: "Verification code sent to your WhatsApp",
    };
  }),
  route("POST", /^\/api\/auth\/password-reset\/complete$/, async ({ body }) => {
    const payload = {
      phone: normalizeIndianPhone(body.phone),
      phone_verification_token: cleanText(body.phone_verification_token),
      password: body.password,
    };
    const parsed = passwordResetCompleteSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid inputs");
    }
    const { phone, phone_verification_token: phoneVerificationToken, password } = parsed.data;

    verifyPhoneVerificationToken(phoneVerificationToken, phone);

    const user = await prisma.user.findUnique({
      where: { phone },
      include: { roles: true }
    });
    if (!user) throw new HttpError(404, "Account not found");

    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id: user.id },
      data: { password_hash: passwordHash }
    });

    const token = generateToken(user);
    const roles = user.roles.map(r => r.role);

    return {
      ok: true,
      user: { id: user.id, email: user.email, phone: user.phone },
      roles,
      message: "Password updated. You are now signed in.",
      __responseHeaders: {
        "Set-Cookie": buildSessionCookies(token),
      },
    };
  }),
  route("POST", /^\/api\/auth\/login$/, async ({ body }) => {
    const payload = {
      phone: normalizeIndianPhone(body.phone),
      password: body.password,
    };
    const parsed = loginSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid credentials");
    }
    const { phone, password } = parsed.data;

    const user = await prisma.user.findUnique({
      where: { phone },
      include: { roles: true }
    });

    if (!user || !(await comparePassword(password, user.password_hash))) {
      throw new HttpError(401, "Invalid credentials");
    }

    const token = generateToken(user);
    const roles = user.roles.map(r => r.role);

    return {
      user: { id: user.id, email: user.email, phone: user.phone },
      roles,
      __responseHeaders: {
        "Set-Cookie": buildSessionCookies(token),
      },
    };
  }),
  route("POST", /^\/api\/auth\/register$/, async ({ body }) => {
    const payload = {
      full_name: cleanText(body.full_name),
      phone: normalizeIndianPhone(body.phone),
      password: body.password,
      phone_verification_token: cleanText(body.phone_verification_token),
      requested_role: body.requested_role || undefined,
      business_name: body.business_name || undefined,
      business_address: body.business_address || undefined,
      business_lat: body.business_lat != null ? Number(body.business_lat) : undefined,
      business_lng: body.business_lng != null ? Number(body.business_lng) : undefined,
      town_name: body.town_name || undefined,
      pincode: body.pincode || undefined,
      role_message: body.role_message || undefined,
    };
    const parsed = registerSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid inputs");
    }
    const {
      full_name: fullName,
      phone,
      password,
      phone_verification_token: phoneVerificationToken,
      requested_role: requestedRole,
      business_name: businessName,
      business_address: businessAddress,
      business_lat: businessLat,
      business_lng: businessLng,
      town_name: townName,
      pincode,
      role_message: roleMessage,
    } = parsed.data;

    verifyPhoneVerificationToken(phoneVerificationToken, phone);

    const existingUser = await prisma.user.findUnique({ where: { phone } });

    if (existingUser) {
      throw new HttpError(409, "This phone number is already registered");
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        phone,
        password_hash: passwordHash,
        profile: {
          create: {
            full_name: fullName,
            phone,
            town_name: townName,
            pincode,
          }
        },
        roles: {
          create: { role: "customer" }
        }
      },
      include: { roles: true }
    });

    if (requestedRole && requestedRole !== "customer") {
      await prisma.roleRequest.create({
        data: {
          user_id: user.id,
          requested_role: requestedRole,
          business_name: businessName,
          business_address: businessAddress,
          business_lat: businessLat,
          business_lng: businessLng,
          town_name: townName,
          pincode: pincode,
          message: roleMessage || "Requested during registration"
        }
      });
    }

    const token = generateToken(user);
    const roles = user.roles.map(r => r.role);

    return {
      user: { id: user.id, email: user.email, phone: user.phone },
      roles,
      authenticated: true,
      __responseHeaders: {
        "Set-Cookie": buildSessionCookies(token),
      },
    };
  }),
  route("POST", /^\/api\/auth\/logout$/, async () => {
    return {
      ok: true,
      __responseHeaders: {
        "Set-Cookie": clearSessionCookies(),
      },
    };
  }),
  route("GET", /^\/api\/auth\/me$/, async ({ user }) => {
    const roles = await getRoles(user.id);
    return { user, roles };
  }),
  route("POST", /^\/api\/notifications\/token$/, async ({ user, body }) => {
    const token = trimToken(body.token);
    if (!token) throw new HttpError(400, "token is required");

    const platform = cleanText(body.platform) || "web";
    const deviceLabel = cleanText(body.device_label || body.user_agent || "");

    const pushToken = await prisma.userPushToken.upsert({
      where: { token },
      update: {
        user_id: user.id,
        platform,
        device_label: deviceLabel || null,
        updated_at: new Date()
      },
      create: {
        user_id: user.id,
        token,
        platform,
        device_label: deviceLabel || null,
      }
    });

    return { pushToken };
  }),
  route("GET", /^\/api\/map\/route$/, async ({ url }) => {
    const fromLat = url.searchParams.get("fromLat");
    const fromLng = url.searchParams.get("fromLng");
    const toLat = url.searchParams.get("toLat");
    const toLng = url.searchParams.get("toLng");

    if (!fromLat || !fromLng || !toLat || !toLng) {
      throw new HttpError(400, "Missing route coordinates");
    }

    if (!env.mapboxAccessToken) {
      throw new HttpError(500, "Missing MAPBOX_ACCESS_TOKEN");
    }

    const mapboxUrl = new URL(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}`,
    );
    mapboxUrl.searchParams.set("geometries", "geojson");
    mapboxUrl.searchParams.set("overview", "full");
    mapboxUrl.searchParams.set("access_token", env.mapboxAccessToken);

    const response = await fetch(mapboxUrl);
    const payload = await response.json();

    if (!response.ok) {
      throw new HttpError(502, "Failed to fetch route");
    }

    const coords = payload?.routes?.[0]?.geometry?.coordinates ?? [];
    return {
      route: coords.map(([lng, lat]) => ({ lat, lng })),
    };
  }),
  route("GET", /^\/api\/profile$/, async ({ user }) => {
    const profile = await prisma.profile.findUnique({
      where: { id: user.id }
    });
    return { profile };
  }),
  route("GET", /^\/api\/profile\/addresses$/, async ({ user }) => {
    const addresses = await prisma.savedAddress.findMany({
      where: { user_id: user.id },
      orderBy: [{ is_default: "desc" }, { created_at: "desc" }]
    });
    return { addresses };
  }),
  route("POST", /^\/api\/profile\/addresses$/, async ({ user, body }) => {
    const payload = {
      label: body.label || undefined,
      address: body.address,
      lat: body.lat != null ? Number(body.lat) : undefined,
      lng: body.lng != null ? Number(body.lng) : undefined,
      is_default: body.is_default,
    };
    const parsed = addressSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid inputs");
    }
    const { label, address: addressText, lat, lng, is_default: isDefault } = parsed.data;

    const address = await prisma.savedAddress.create({
      data: {
        user_id: user.id,
        label: label || "Saved address",
        address: addressText,
        lat: lat ?? null,
        lng: lng ?? null,
        is_default: !!isDefault,
      }
    });

    return { address };
  }),
  route("DELETE", /^\/api\/profile\/addresses\/([^/]+)$/, async ({ match }) => {
    const id = decodeURIComponent(match[1]);
    await prisma.savedAddress.delete({ where: { id } });
    return { ok: true };
  }),
  route("PUT", /^\/api\/profile$/, async ({ user, body }) => {
    const payload = {
      full_name: cleanText(body.full_name),
      phone: normalizeIndianPhone(body.phone),
    };
    const parsed = profileUpdateSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid inputs");
    }
    const { full_name: fullName, phone } = parsed.data;

    const profile = await prisma.profile.update({
      where: { id: user.id },
      data: {
        full_name: fullName,
        phone: phone,
      }
    });

    return { profile };
  }),
  route("GET", /^\/api\/role-requests$/, async ({ user }) => {
    const requests = await prisma.roleRequest.findMany({
      where: { user_id: user.id },
      orderBy: { created_at: "desc" }
    });
    return { requests };
  }),
  route("POST", /^\/api\/role-requests$/, async ({ user, body }) => {
    const requestedRole = normalizeBusinessRole(body.requested_role);
    if (!requestedRole) throw new HttpError(400, "Choose a valid role to request");

    const request = await prisma.roleRequest.create({
      data: {
        user_id: user.id,
        requested_role: requestedRole,
        business_name: cleanText(body.business_name) || null,
        message: cleanText(body.message) || null,
      }
    });

    return { request };
  }),
  route("POST", /^\/api\/live-location$/, async ({ body }) => {
    const allowedTables = new Set(["rides", "package_deliveries", "food_orders", "grocery_orders"]);

    if (!allowedTables.has(body.table)) {
      throw new HttpError(400, "Invalid live location target");
    }

    const modelName = {
      rides: "ride",
      package_deliveries: "packageDelivery",
      food_orders: "foodOrder",
      grocery_orders: "groceryOrder"
    }[body.table];

    const row = await prisma[modelName].update({
      where: { id: body.row_id },
      data: {
        rider_lat: body.rider_lat,
        rider_lng: body.rider_lng,
        rider_location_updated_at: new Date(),
      },
    });

    return { row };
  }),
  route("GET", /^\/api\/catalog\/restaurants$/, async ({ user, url }) => {
    let location = await getUserCatalogLocation(user.id);
    const radiusKm = await getCatalogRadiusKm();

    const latParam = url.searchParams.get("lat");
    const lngParam = url.searchParams.get("lng");
    if (latParam && lngParam) {
      location = { ...location, lat: Number(latParam), lng: Number(lngParam) };
    }

    const restaurants = await prisma.restaurant.findMany({
      orderBy: { created_at: "desc" }
    });

    return {
      restaurants: filterCatalogRowsByLocation(restaurants, location, radiusKm),
      location: { ...location, radius_km: radiusKm },
    };
  }),
  route("GET", /^\/api\/catalog\/restaurants\/([^/]+)$/, async ({ match }) => {
    const restaurantId = decodeURIComponent(match[1]);
    const [restaurant, items] = await Promise.all([
      prisma.restaurant.findUnique({
        where: { id: restaurantId }
      }),
      prisma.menuItem.findMany({
        where: {
          restaurant_id: restaurantId,
          is_available: true
        },
        orderBy: { category: "asc" }
      }),
    ]);

    return {
      restaurant,
      items: items ?? [],
    };
  }),
  route("GET", /^\/api\/catalog\/items\/food$/, async ({ user, url }) => {
    let location = await getUserCatalogLocation(user.id);
    const radiusKm = await getCatalogRadiusKm();

    const latParam = url.searchParams.get("lat");
    const lngParam = url.searchParams.get("lng");
    if (latParam && lngParam) {
      location = { ...location, lat: Number(latParam), lng: Number(lngParam) };
    }

    const restaurants = await prisma.restaurant.findMany({
      select: { id: true, town_name: true, pincode: true, lat: true, lng: true, is_open: true }
    });
    const visibleRestaurants = filterCatalogRowsByLocation(restaurants, location, radiusKm).filter(
      (row) => row?.is_open !== false,
    );
    const restaurantIds = visibleRestaurants.map((row) => row.id).filter(Boolean);
    if (restaurantIds.length === 0) return { items: [] };

    const items = await prisma.menuItem.findMany({
      where: {
        is_available: true,
        restaurant_id: { in: restaurantIds }
      },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        image_url: true,
        category: true,
        is_available: true,
        restaurant_id: true,
        restaurant: { select: { name: true } }
      },
      take: 12
    });
    // Flatten Prisma's relation structure to match the expected API response structure
    const flattenedItems = items.map(item => ({
      ...item,
      restaurants: item.restaurant
    }));
    return { items: flattenedItems ?? [] };
  }),
  route("GET", /^\/api\/catalog\/items\/grocery$/, async ({ user, url }) => {
    let location = await getUserCatalogLocation(user.id);
    const radiusKm = await getCatalogRadiusKm();

    const latParam = url.searchParams.get("lat");
    const lngParam = url.searchParams.get("lng");
    if (latParam && lngParam) {
      location = { ...location, lat: Number(latParam), lng: Number(lngParam) };
    }

    const stores = await prisma.groceryStore.findMany({
      select: { id: true, town_name: true, pincode: true, lat: true, lng: true, is_open: true }
    });
    const visibleStores = filterCatalogRowsByLocation(stores, location, radiusKm).filter(
      (row) => row?.is_open !== false,
    );
    const storeIds = visibleStores.map((row) => row.id).filter(Boolean);
    if (storeIds.length === 0) return { items: [] };

    const items = await prisma.groceryItem.findMany({
      where: {
        is_available: true,
        store_id: { in: storeIds }
      },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        image_url: true,
        category: true,
        is_available: true,
        store_id: true,
        store: { select: { name: true } }
      },
      take: 12
    });
    // Flatten Prisma's relation structure to match the expected API response structure
    const flattenedItems = items.map(item => ({
      ...item,
      grocery_stores: item.store
    }));
    return { items: flattenedItems ?? [] };
  }),
  route("GET", /^\/api\/catalog\/stores$/, async ({ user, url }) => {
    let location = await getUserCatalogLocation(user.id);
    const radiusKm = await getCatalogRadiusKm();

    const latParam = url.searchParams.get("lat");
    const lngParam = url.searchParams.get("lng");
    if (latParam && lngParam) {
      location = { ...location, lat: Number(latParam), lng: Number(lngParam) };
    }

    const stores = await prisma.groceryStore.findMany({
      orderBy: { created_at: "desc" }
    });

    return {
      stores: filterCatalogRowsByLocation(stores, location, radiusKm),
      location: { ...location, radius_km: radiusKm },
    };
  }),
  route("GET", /^\/api\/catalog\/stores\/([^/]+)$/, async ({ match }) => {
    const storeId = decodeURIComponent(match[1]);
    const [store, items] = await Promise.all([
      prisma.groceryStore.findUnique({
        where: { id: storeId }
      }),
      prisma.groceryItem.findMany({
        where: {
          store_id: storeId,
          is_available: true
        },
        orderBy: { category: "asc" }
      }),
    ]);

    return {
      store,
      items: items ?? [],
    };
  }),
  route("POST", /^\/api\/orders\/food$/, async ({ user, body }) => {
    const items = validateCartItems(body.items);
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: body.restaurant_id },
      select: { id: true, name: true, address: true, town_name: true, pincode: true, lat: true, lng: true, is_open: true }
    });
    if (!restaurant || restaurant.is_open === false) {
      throw new HttpError(400, "This restaurant is not accepting orders right now");
    }

    const menuItems = await prisma.menuItem.findMany({
      where: {
        restaurant_id: body.restaurant_id,
        id: { in: items.map((item) => item.id) }
      },
      select: { id: true, name: true, price: true, is_available: true, prep_time_minutes: true }
    });
    const menuById = new Map((menuItems ?? []).map((item) => [item.id, item]));
    let maxPrep = 15;
    for (const item of items) {
      const menuItem = menuById.get(item.id);
      if (!menuItem || menuItem.is_available === false) {
        throw new HttpError(400, `${item.name} is no longer available`);
      }
      if (Number(menuItem.price) !== item.price) {
        throw new HttpError(400, `Price changed for ${item.name}. Refresh your cart.`);
      }
      maxPrep = Math.max(maxPrep, Number(menuItem.prep_time_minutes ?? 15));
    }

    const deliveryAddress = requireText(body.delivery_address, "Delivery address", 300);
    const deliveryLat = requireNumber(body.delivery_lat, "Delivery latitude");
    const deliveryLng = requireNumber(body.delivery_lng, "Delivery longitude");
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const deliveryPin = generateDeliveryPin();
    const estimatedDeliveryAt = estimateDeliveryAt(
      maxPrep,
      restaurant.lat != null && restaurant.lng != null
        ? { lat: restaurant.lat, lng: restaurant.lng }
        : null,
      { lat: deliveryLat, lng: deliveryLng },
      distanceKm,
    );

    const order = await prisma.foodOrder.create({
      data: {
        customer_id: user.id,
        restaurant_id: body.restaurant_id,
        delivery_address: deliveryAddress,
        delivery_lat: deliveryLat,
        delivery_lng: deliveryLng,
        pickup_address:
          [restaurant.address, restaurant.town_name, restaurant.pincode]
            .filter(Boolean)
            .join(", ") || restaurant.name,
        pickup_lat: restaurant.lat ?? null,
        pickup_lng: restaurant.lng ?? null,
        notes: body.notes || null,
        total,
        payment_method: body.payment_method || "cash",
        delivery_pin: deliveryPin,
        estimated_delivery_at: estimatedDeliveryAt,
        contactless_delivery: !!body.contactless_delivery,
        items: {
          create: items.map((item) => ({
            menu_item_id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
          }))
        }
      }
    });

    return { order };
  }),
  route("POST", /^\/api\/orders\/grocery$/, async ({ user, body }) => {
    const items = validateCartItems(body.items);
    const store = await prisma.groceryStore.findUnique({
      where: { id: body.store_id },
      select: { id: true, name: true, address: true, town_name: true, pincode: true, lat: true, lng: true, is_open: true }
    });
    if (!store || store.is_open === false) {
      throw new HttpError(400, "This store is not accepting orders right now");
    }

    const groceryItems = await prisma.groceryItem.findMany({
      where: {
        store_id: body.store_id,
        id: { in: items.map((item) => item.id) }
      },
      select: { id: true, name: true, price: true, is_available: true, stock_quantity: true }
    });
    const groceryById = new Map((groceryItems ?? []).map((item) => [item.id, item]));
    for (const item of items) {
      const groceryItem = groceryById.get(item.id);
      if (!groceryItem || groceryItem.is_available === false) {
        throw new HttpError(400, `${item.name} is no longer available`);
      }
      if (Number(groceryItem.price) !== item.price) {
        throw new HttpError(400, `Price changed for ${item.name}. Refresh your cart.`);
      }
      const stock = Number(groceryItem.stock_quantity ?? 0);
      if (stock > 0 && stock < item.quantity) {
        throw new HttpError(400, `${item.name} only has ${stock} left in stock`);
      }
    }

    const deliveryAddress = requireText(body.delivery_address, "Delivery address", 300);
    const deliveryLat = requireNumber(body.delivery_lat, "Delivery latitude");
    const deliveryLng = requireNumber(body.delivery_lng, "Delivery longitude");
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const deliveryPin = generateDeliveryPin();
    const estimatedDeliveryAt = estimateDeliveryAt(
      20,
      store.lat != null && store.lng != null ? { lat: store.lat, lng: store.lng } : null,
      { lat: deliveryLat, lng: deliveryLng },
      distanceKm,
    );

    const order = await prisma.groceryOrder.create({
      data: {
        customer_id: user.id,
        store_id: body.store_id,
        delivery_address: deliveryAddress,
        delivery_lat: deliveryLat,
        delivery_lng: deliveryLng,
        pickup_address:
          [store.address, store.town_name, store.pincode].filter(Boolean).join(", ") || store.name,
        pickup_lat: store.lat ?? null,
        pickup_lng: store.lng ?? null,
        notes: body.notes || null,
        total,
        payment_method: body.payment_method || "cash",
        delivery_pin: deliveryPin,
        estimated_delivery_at: estimatedDeliveryAt,
        contactless_delivery: !!body.contactless_delivery,
        items: {
          create: items.map((item) => ({
            grocery_item_id: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
          }))
        }
      }
    });

    await deductGroceryStock(body.store_id, items);

    return { order };
  }),
  route("GET", /^\/api\/orders\/me$/, async ({ user }) => {
    const [food, grocery, rides, packages] = await Promise.all([
      prisma.foodOrder.findMany({
        where: { customer_id: user.id },
        orderBy: { created_at: "desc" },
        include: { restaurant: { select: { name: true } } }
      }),
      prisma.groceryOrder.findMany({
        where: { customer_id: user.id },
        orderBy: { created_at: "desc" },
        include: { store: { select: { name: true } } }
      }),
      prisma.ride.findMany({
        where: { customer_id: user.id },
        orderBy: { created_at: "desc" }
      }),
      prisma.packageDelivery.findMany({
        where: { customer_id: user.id },
        orderBy: { created_at: "desc" }
      }),
    ]);

    // Format Prisma includes to match expected API response structure
    const formatFood = (list) => list.map(o => ({ ...o, restaurants: o.restaurant, rider_id: o.delivery_boy_id }));
    const formatGrocery = (list) => list.map(o => ({ ...o, grocery_stores: o.store, rider_id: o.delivery_boy_id }));

    return {
      food: await attachUserProfiles(formatFood(food ?? []), { customer: "customer_id", rider: "rider_id" }),
      grocery: await attachUserProfiles(formatGrocery(grocery ?? []), { customer: "customer_id", rider: "rider_id" }),
      rides: await attachUserProfiles(rides ?? [], { customer: "customer_id", rider: "rider_id" }),
      packages: await attachUserProfiles(packages ?? [], { customer: "customer_id", rider: "rider_id" }),
    };
  }),
  route(
    "POST",
    /^\/api\/orders\/(ride|package|food|grocery)\/([^/]+)\/cancel$/,
    async ({ user, match, body }) => {
      const kind = match[1];
      const id = decodeURIComponent(match[2]);
      const modelName = {
        ride: "ride",
        package: "packageDelivery",
        food: "foodOrder",
        grocery: "groceryOrder",
      }[kind];

      const current = await prisma[modelName].findUnique({
        where: { id, customer_id: user.id },
        select: { id: true, status: true, customer_id: true }
      });

      assertCancellable(current, kind);

      const row = await prisma[modelName].update({
        where: { id, customer_id: user.id },
        data: {
          status: "cancelled",
          // cancellation_reason and cancelled_at are not in the schema.
        },
      });

      return { row };
    },
  ),
  route("GET", /^\/api\/track\/(ride|package|food|grocery)\/([^/]+)$/, async ({ match }) => {
    const kind = match[1];
    const id = decodeURIComponent(match[2]);
    const modelName = {
      ride: "ride",
      package: "packageDelivery",
      food: "foodOrder",
      grocery: "groceryOrder",
    }[kind];

    const row = await prisma[modelName].findUnique({
      where: { id },
      include: kind === "food"
        ? { restaurant: { select: { name: true } } }
        : kind === "grocery"
          ? { store: { select: { name: true } } }
          : undefined
    });

    if (!row) return { row: null };

    const normalizedRow = kind === "food" || kind === "grocery" ? normalizeDeliveryOrder(row) : row;
    // Map Prisma includes
    if (kind === "food") normalizedRow.restaurants = row.restaurant;
    if (kind === "grocery") normalizedRow.grocery_stores = row.store;

    const hydratedRow = await attachUserProfiles(normalizedRow, {
      customer: "customer_id",
      rider: "rider_id",
    });
    const partner = hydratedRow.rider || null;

    // Backwards compatibility for frontend expectations
    return {
      row: {
        ...hydratedRow,
        partner: partner || hydratedRow.customer || null,
        profiles: hydratedRow.customer || null
      },
    };
  }),
  route(
    "GET",
    /^\/api\/chat\/(ride|package|food|grocery)\/([^/]+)$/,
    async ({ user, match }) => {
      const kind = match[1];
      const serviceId = decodeURIComponent(match[2]);
      const context = await getChatContext(user, kind, serviceId);

      const messages = await prisma.chatMessage.findMany({
        where: {
          service_kind: context.kind,
          service_id: serviceId
        },
        orderBy: { created_at: "asc" },
        take: 100
      });

      return {
        messages: messages ?? [],
        participant: {
          customer_id: context.row.customer_id,
          partner_id: context.row[context.partnerColumn] ?? null,
        },
      };
    },
  ),
  route(
    "POST",
    /^\/api\/chat\/(ride|package|food|grocery)\/([^/]+)$/,
    async ({ user, match, body }) => {
      const kind = match[1];
      const serviceId = decodeURIComponent(match[2]);
      const context = await getChatContext(user, kind, serviceId);

      const messageBody = cleanText(body.message);
      if (!messageBody) {
        throw new HttpError(400, "Message is required");
      }

      if (messageBody.length > 1000) {
        throw new HttpError(400, "Message is too long");
      }

      const saved = await prisma.chatMessage.create({
        data: {
          service_kind: kind,
          service_id: serviceId,
          sender_id: user.id,
          body: messageBody,
        }
      });
      void notifyChatRecipients({
        senderId: user.id,
        context,
        kind,
        serviceId,
        messageBody,
      }).catch((error) => {
        logEvent("warn", "chat_push_notify_failed", {
          serviceId,
          kind,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return { message: saved };
    },
  ),
  route("POST", /^\/api\/rides$/, async ({ user, body }) => {
    const pickupLat = requireNumber(body.pickup_lat, "Pickup latitude");
    const pickupLng = requireNumber(body.pickup_lng, "Pickup longitude");
    const dropLat = requireNumber(body.drop_lat, "Drop latitude");
    const dropLng = requireNumber(body.drop_lng, "Drop longitude");
    const pickupAddress = requireText(body.pickup_address, "Pickup address", 300);
    const dropAddress = requireText(body.drop_address, "Drop address", 300);
    const fareEstimate = requireNumber(body.fare_estimate, "Fare estimate");
    const deliveryPin = generateDeliveryPin();
    const estimatedArrivalAt = estimateDeliveryAt(
      5,
      { lat: pickupLat, lng: pickupLng },
      { lat: dropLat, lng: dropLng },
      distanceKm,
    );
    const ride = await prisma.ride.create({
      data: {
        customer_id: user.id,
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        pickup_address: pickupAddress,
        drop_lat: dropLat,
        drop_lng: dropLng,
        drop_address: dropAddress,
        fare_estimate: fareEstimate,
        vehicle_type: body.vehicle_type || "bike",
        notes: body.notes || null,
        payment_method: body.payment_method || "cash",
        delivery_pin: deliveryPin,
        estimated_arrival_at: estimatedArrivalAt,
      }
    });

    return { ride };
  }),
  route("POST", /^\/api\/packages$/, async ({ user, body }) => {
    const pickupLat = requireNumber(body.pickup_lat, "Pickup latitude");
    const pickupLng = requireNumber(body.pickup_lng, "Pickup longitude");
    const dropLat = requireNumber(body.drop_lat, "Drop latitude");
    const dropLng = requireNumber(body.drop_lng, "Drop longitude");
    const pickupAddress = requireText(body.pickup_address, "Pickup address", 300);
    const dropAddress = requireText(body.drop_address, "Drop address", 300);
    const receiverName = requireText(body.receiver_name, "Receiver name", 120);
    const receiverPhone = requireText(body.receiver_phone, "Receiver phone", 30);
    const fareEstimate = requireNumber(body.fare_estimate, "Fare estimate");
    const deliveryPin = generateDeliveryPin();
    const estimatedDeliveryAt = estimateDeliveryAt(
      10,
      { lat: pickupLat, lng: pickupLng },
      { lat: dropLat, lng: dropLng },
      distanceKm,
    );
    const packageDelivery = await prisma.packageDelivery.create({
      data: {
        customer_id: user.id,
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        pickup_address: pickupAddress,
        drop_lat: dropLat,
        drop_lng: dropLng,
        drop_address: dropAddress,
        fare_estimate: fareEstimate,
        package_size: body.package_size || "small",
        receiver_name: receiverName,
        receiver_phone: receiverPhone,
        notes: body.notes || null,
        payment_method: body.payment_method || "cash",
        delivery_pin: deliveryPin,
        estimated_delivery_at: estimatedDeliveryAt,
      }
    });

    return { packageDelivery };
  }),
  route("POST", /^\/api\/admin\/notifications\/test$/, async ({ user, body }) => {
    const roles = await getRoles(user.id);
    if (!roles.includes("admin")) {
      throw new HttpError(403, "Only admin users can send test notifications");
    }

    const explicitToken = trimToken(body.token);
    const targetUserId = cleanText(body.user_id);

    let targetTokens = explicitToken ? [explicitToken] : [];
    if (!explicitToken && targetUserId) {
      const tokens = await prisma.userPushToken.findMany({
        where: { user_id: targetUserId },
        orderBy: { updated_at: "desc" },
        take: 5,
        select: { token: true }
      });
      targetTokens = (tokens ?? []).map((row) => trimToken(row.token)).filter(Boolean);
    }

    if (targetTokens.length === 0) {
      throw new HttpError(400, "Provide token or user_id with at least one saved token");
    }

    const title = cleanText(body.title) || "Test notification";
    const message = cleanText(body.body) || "This is a test push from Rweezy backend.";
    const data = body.data && typeof body.data === "object" ? body.data : {};

    const results = [];
    for (const fcmToken of targetTokens) {
      try {
        const result = await sendFcmNotification({
          token: fcmToken,
          title,
          body: message,
          data,
        });
        results.push({ token: fcmToken, ok: true, result });
      } catch (error) {
        results.push({
          token: fcmToken,
          ok: false,
          error: error instanceof Error ? error.message : "Failed",
        });
      }
    }

    return {
      sent: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    };
  }),
  route("GET", /^\/api\/admin\/stats$/, async () => {
    const [users, restaurants, foodOrders, rides, packages, stores] = await Promise.all([
      prisma.user.count(),
      prisma.restaurant.count(),
      prisma.foodOrder.count(),
      prisma.ride.count(),
      prisma.packageDelivery.count(),
      prisma.groceryStore.count(),
    ]);

    return {
      users,
      restaurants,
      foodOrders,
      rides,
      packages,
      stores,
    };
  }),
  route("GET", /^\/api\/admin\/analytics$/, async () => {
    const [profiles, deliveryRoles, restaurants, stores, foodOrders, groceryOrders] =
      await Promise.all([
        prisma.profile.findMany({ select: { id: true, full_name: true, phone: true } }),
        prisma.userRole.findMany({ where: { role: "delivery_boy" }, select: { user_id: true, role: true } }),
        prisma.restaurant.findMany({ select: { id: true, name: true, is_open: true }, orderBy: { name: "asc" } }),
        prisma.groceryStore.findMany({ select: { id: true, name: true, is_open: true }, orderBy: { name: "asc" } }),
        prisma.foodOrder.findMany({
          select: {
            id: true,
            restaurant_id: true,
            total: true,
            status: true,
            created_at: true,
            delivery_boy_id: true,
            delivery_lat: true,
            delivery_lng: true,
            rider_lat: true,
            rider_lng: true,
          }
        }),
        prisma.groceryOrder.findMany({
          select: {
            id: true,
            store_id: true,
            total: true,
            status: true,
            created_at: true,
            delivery_boy_id: true,
            delivery_lat: true,
            delivery_lng: true,
            rider_lat: true,
            rider_lng: true,
          }
        }),
      ]);

    const todayStart = startOfLocalDay();
    const monthStart = startOfLocalMonth();
    const deliveredStatuses = new Set(["delivered"]);
    const deliveryBoyIds = new Set((deliveryRoles ?? []).map((role) => role.user_id));
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));

    const summarizePartner = (partners, orders, idKey) =>
      (partners ?? []).map((partner) => {
        const partnerOrders = (orders ?? []).filter((order) => order[idKey] === partner.id);
        const delivered = partnerOrders.filter((order) => deliveredStatuses.has(order.status));
        const todayOrders = delivered.filter((order) => isOnOrAfter(order.created_at, todayStart));
        const monthOrders = delivered.filter((order) => isOnOrAfter(order.created_at, monthStart));

        return {
          id: partner.id,
          name: partner.name,
          is_open: partner.is_open,
          todayOrders: todayOrders.length,
          todayIncome: todayOrders.reduce((sum, order) => sum + money(order.total), 0),
          monthOrders: monthOrders.length,
          monthIncome: monthOrders.reduce((sum, order) => sum + money(order.total), 0),
          totalOrders: partnerOrders.length,
        };
      });

    const deliverySummary = new Map();
    const ensureDeliveryBoy = (userId) => {
      if (!userId) return null;
      if (!deliverySummary.has(userId)) {
        const profile = profileById.get(userId);
        deliverySummary.set(userId, {
          id: userId,
          name: profile?.full_name || "Unnamed delivery boy",
          phone: profile?.phone ?? null,
          foodDeliveries: 0,
          groceryDeliveries: 0,
          todayDeliveries: 0,
          monthDeliveries: 0,
          trackedKm: 0,
          foodIncomeHandled: 0,
          groceryIncomeHandled: 0,
        });
      }
      return deliverySummary.get(userId);
    };

    for (const userId of deliveryBoyIds) {
      ensureDeliveryBoy(userId);
    }

    const addDeliveryOrder = (order, kind) => {
      const summary = ensureDeliveryBoy(order.delivery_boy_id);
      if (!summary) return;

      const delivered = deliveredStatuses.has(order.status);
      if (kind === "food" && delivered) {
        summary.foodDeliveries += 1;
        summary.foodIncomeHandled += money(order.total);
      }
      if (kind === "grocery" && delivered) {
        summary.groceryDeliveries += 1;
        summary.groceryIncomeHandled += money(order.total);
      }
      if (delivered && isOnOrAfter(order.created_at, todayStart)) summary.todayDeliveries += 1;
      if (delivered && isOnOrAfter(order.created_at, monthStart)) summary.monthDeliveries += 1;

      summary.trackedKm += distanceKm(
        order.rider_lat != null && order.rider_lng != null
          ? { lat: order.rider_lat, lng: order.rider_lng }
          : null,
        order.delivery_lat != null && order.delivery_lng != null
          ? { lat: order.delivery_lat, lng: order.delivery_lng }
          : null,
      );
    };

    for (const order of foodOrders ?? []) addDeliveryOrder(order, "food");
    for (const order of groceryOrders ?? []) addDeliveryOrder(order, "grocery");

    const restaurantIncome = summarizePartner(restaurants, foodOrders, "restaurant_id").sort(
      (a, b) => b.monthIncome - a.monthIncome,
    );
    const groceryStoreIncome = summarizePartner(stores, groceryOrders, "store_id").sort(
      (a, b) => b.monthIncome - a.monthIncome,
    );
    const deliveryBoys = [...deliverySummary.values()]
      .map((summary) => ({
        ...summary,
        totalDeliveries: summary.foodDeliveries + summary.groceryDeliveries,
        trackedKm: Number(summary.trackedKm.toFixed(2)),
      }))
      .sort((a, b) => b.monthDeliveries - a.monthDeliveries);

    const totalRestaurantMonthIncome = restaurantIncome.reduce(
      (sum, item) => sum + item.monthIncome,
      0,
    );
    const totalGroceryMonthIncome = groceryStoreIncome.reduce(
      (sum, item) => sum + item.monthIncome,
      0,
    );

    return {
      restaurantIncome,
      groceryStoreIncome,
      deliveryBoys,
      totals: {
        restaurantTodayIncome: restaurantIncome.reduce((sum, item) => sum + item.todayIncome, 0),
        restaurantMonthIncome: totalRestaurantMonthIncome,
        groceryTodayIncome: groceryStoreIncome.reduce((sum, item) => sum + item.todayIncome, 0),
        groceryMonthIncome: totalGroceryMonthIncome,
        deliveryBoys: deliveryBoys.length,
        deliveriesToday: deliveryBoys.reduce((sum, item) => sum + item.todayDeliveries, 0),
        deliveriesMonth: deliveryBoys.reduce((sum, item) => sum + item.monthDeliveries, 0),
        trackedKm: Number(deliveryBoys.reduce((sum, item) => sum + item.trackedKm, 0).toFixed(2)),
      },
    };
  }),
  route("GET", /^\/api\/admin\/restaurants$/, async ({ url }) => {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") ?? 20)));
    const offset = (page - 1) * limit;
    const fetchLimit = limit + 1;
    const restaurants = await prisma.restaurant.findMany({
      orderBy: { created_at: "desc" },
      take: fetchLimit,
      skip: offset
    });
    const hasNext = (restaurants?.length ?? 0) > limit;
    const pageRestaurants = (restaurants ?? []).slice(0, limit);
    const managerIds = pageRestaurants
      .map((item) => item?.manager_id)
      .filter((id) => id);
    const restaurantIds = pageRestaurants
      .map((item) => item?.id)
      .filter((id) => id);
    const [profiles, roles, orders] = await Promise.all([
      managerIds.length > 0
        ? prisma.profile.findMany({
            where: { id: { in: managerIds } },
            select: { id: true, full_name: true }
          })
        : [],
      managerIds.length > 0
        ? prisma.userRole.findMany({
            where: { role: "hotel_manager", user_id: { in: managerIds } },
            select: { user_id: true, role: true }
          })
        : [],
      restaurantIds.length > 0
        ? prisma.foodOrder.findMany({
            where: { restaurant_id: { in: restaurantIds } },
            select: { restaurant_id: true }
          })
        : [],
    ]);

    return {
      restaurants: pageRestaurants,
      profiles: profiles ?? [],
      roles: roles ?? [],
      orders: orders ?? [],
      page,
      limit,
      hasNext,
    };
  }),
  route("POST", /^\/api\/admin\/restaurants$/, async ({ body }) => {
    const restaurant = await prisma.restaurant.create({
      data: body
    });

    return { restaurant };
  }),
  route("PUT", /^\/api\/admin\/restaurants\/([^/]+)$/, async ({ match, body }) => {
    const id = decodeURIComponent(match[1]);
    const restaurant = await prisma.restaurant.update({
      where: { id },
      data: body
    });

    return { restaurant };
  }),
  route("DELETE", /^\/api\/admin\/restaurants\/([^/]+)$/, async ({ match }) => {
    const id = decodeURIComponent(match[1]);
    await prisma.restaurant.delete({ where: { id } });

    return { ok: true };
  }),
  route("POST", /^\/api\/admin\/restaurants\/([^/]+)\/toggle$/, async ({ match, body }) => {
    const id = decodeURIComponent(match[1]);
    const restaurant = await prisma.restaurant.update({
      where: { id },
      data: { is_open: !!body.is_open }
    });

    return { restaurant };
  }),
  route(
    "POST",
    /^\/api\/admin\/restaurants\/([^/]+)\/grant-manager$/,
    async ({ match, body }) => {
      const id = decodeURIComponent(match[1]);
      if (!body.user_id) throw new HttpError(400, "user_id is required");

      await prisma.userRole.upsert({
        where: { user_id_role: { user_id: body.user_id, role: "hotel_manager" } },
        update: {},
        create: { user_id: body.user_id, role: "hotel_manager" }
      });

      const restaurant = await prisma.restaurant.update({
        where: { id },
        data: { manager_id: body.user_id }
      });

      return { restaurant };
    },
  ),
  route(
    "POST",
    /^\/api\/admin\/restaurants\/([^/]+)\/revoke-manager$/,
    async ({ match, body }) => {
      const id = decodeURIComponent(match[1]);
      if (!body.user_id) throw new HttpError(400, "user_id is required");

      await prisma.userRole.delete({
        where: { user_id_role: { user_id: body.user_id, role: "hotel_manager" } }
      }).catch(() => {});

      const restaurant = await prisma.restaurant.update({
        where: { id },
        data: { manager_id: null, is_open: false }
      });

      return { restaurant };
    },
  ),
  route("GET", /^\/api\/admin\/stores$/, async ({ url }) => {
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") ?? 20)));
    const offset = (page - 1) * limit;
    const fetchLimit = limit + 1;
    const stores = await prisma.groceryStore.findMany({
      orderBy: { created_at: "desc" },
      take: fetchLimit,
      skip: offset
    });
    const hasNext = (stores?.length ?? 0) > limit;
    const pageStores = (stores ?? []).slice(0, limit);

    return { stores: pageStores, page, limit, hasNext };
  }),
  route("POST", /^\/api\/admin\/stores$/, async ({ body }) => {
    const store = await prisma.groceryStore.create({
      data: body
    });

    return { store };
  }),
  route("PUT", /^\/api\/admin\/stores\/([^/]+)$/, async ({ match, body }) => {
    const id = decodeURIComponent(match[1]);
    const store = await prisma.groceryStore.update({
      where: { id },
      data: body
    });

    return { store };
  }),
  route("DELETE", /^\/api\/admin\/stores\/([^/]+)$/, async ({ match }) => {
    const id = decodeURIComponent(match[1]);
    await prisma.groceryStore.delete({ where: { id } });

    return { ok: true };
  }),
  route("GET", /^\/api\/admin\/users$/, async ({ url }) => {
    const search = cleanText(url.searchParams.get("search"));
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") ?? 50)));
    const offset = (page - 1) * limit;

    const where = search ? {
      OR: [
        { full_name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } }
      ]
    } : {};

    const [profiles, roleRequests, total] = await Promise.all([
      prisma.profile.findMany({
        where,
        orderBy: { full_name: "asc" },
        take: limit,
        skip: offset
      }),
      prisma.roleRequest.findMany({
        where: { status: "pending" },
        orderBy: { created_at: "desc" }
      }),
      prisma.profile.count({ where })
    ]);

    const pageUserIds = profiles.map(p => o.id);
    const roles = await prisma.userRole.findMany({
      where: { user_id: { in: pageUserIds } },
      select: { user_id: true, role: true }
    });

    return {
      profiles: profiles ?? [],
      roles: roles ?? [],
      roleRequests: roleRequests ?? [],
      page,
      limit,
      total
    };
  }),
  route(
    "POST",
    /^\/api\/admin\/users\/([^/]+)\/roles\/toggle$/,
    async ({ user, match, body }) => {
      const userId = decodeURIComponent(match[1]);
      const role = body.role;
      const hasRole = !!body.has_role;

      if (!role) throw new HttpError(400, "role is required");

      if (hasRole) {
        await prisma.userRole.delete({
          where: { user_id_role: { user_id: userId, role } }
        }).catch(() => {});
      } else {
        await prisma.userRole.upsert({
          where: { user_id_role: { user_id: userId, role } },
          update: {},
          create: { user_id: userId, role }
        });
      }

      await writeAudit(
        user.id,
        hasRole ? "role_removed" : "role_granted",
        "user",
        userId,
        `${hasRole ? "Removed" : "Granted"} ${role} role`,
        { role },
      );

      return { ok: true };
    },
  ),
  route(
    "POST",
    /^\/api\/admin\/role-requests\/([^/]+)\/review$/,
    async ({ user, match, body }) => {
      const requestId = decodeURIComponent(match[1]);
      const decision =
        body.decision === "approved"
          ? "approved"
          : body.decision === "rejected"
            ? "rejected"
            : null;
      if (!decision) throw new HttpError(400, "Decision must be approved or rejected");

      const request = await prisma.roleRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new HttpError(404, "Role request not found");

      if (decision === "approved") {
        await prisma.userRole.upsert({
          where: { user_id_role: { user_id: request.user_id, role: request.requested_role } },
          update: {},
          create: { user_id: request.user_id, role: request.requested_role }
        });

        const listingModel =
          request.requested_role === "hotel_manager"
            ? "restaurant"
            : request.requested_role === "grocery_manager"
              ? "groceryStore"
              : null;
        if (listingModel) {
          const existing = await prisma[listingModel].findUnique({
            where: { manager_id: request.user_id }
          });
          if (!existing) {
            await prisma[listingModel].create({
              data: {
                manager_id: request.user_id,
                name: request.business_name,
                address: request.business_address,
                town_name: request.town_name,
                pincode: request.pincode,
                lat: request.business_lat,
                lng: request.business_lng,
                is_open: true,
              }
            });
          }
        }
      }

      const updatedRequest = await prisma.roleRequest.update({
        where: { id: requestId },
        data: {
          status: decision,
          reviewed_by: user.id,
          reviewed_at: new Date(),
        }
      });

      await writeAudit(
        user.id,
        `role_request_${decision}`,
        "role_request",
        requestId,
        `${decision === "approved" ? "Approved" : "Rejected"} ${request.requested_role} request`,
        { user_id: request.user_id, requested_role: request.requested_role },
      );

      return { request: updatedRequest };
    },
  ),
  route("GET", /^\/api\/hotel\/dashboard$/, async ({ user }) => {
    const restaurant = await prisma.restaurant.findUnique({
      where: { manager_id: user.id }
    });

    if (!restaurant) {
      return { restaurant: null, stats: { total: 0, pending: 0, today: 0 } };
    }

    const orders = await prisma.foodOrder.findMany({
      where: { restaurant_id: restaurant.id },
      select: { id: true, status: true, created_at: true }
    });

    const today = new Date().toDateString();
    return {
      restaurant,
      stats: {
        total: orders?.length ?? 0,
        pending:
          orders?.filter((order) => ["pending", "accepted", "preparing"].includes(order.status))
            .length ?? 0,
        today:
          orders?.filter((order) => new Date(order.created_at).toDateString() === today).length ??
          0,
      },
    };
  }),
  route("PUT", /^\/api\/hotel\/restaurant$/, async ({ user, body }) => {
    const payload = {
      name: body.name,
      description: body.description ?? null,
      address: body.address ?? null,
      town_name: body.town_name ?? null,
      pincode: body.pincode ?? null,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      image_url: body.image_url ?? null,
      is_open: body.is_open ?? true,
      manager_id: user.id,
    };

    const restaurant = body.id
      ? await prisma.restaurant.update({
          where: { id: body.id },
          data: payload
        })
      : await prisma.restaurant.create({
          data: payload
        });

    return { restaurant };
  }),
  route("GET", /^\/api\/hotel\/menu$/, async ({ user }) => {
    const restaurant = await prisma.restaurant.findUnique({
      where: { manager_id: user.id },
      select: { id: true }
    });

    if (!restaurant) {
      return { restaurantId: null, items: [] };
    }

    const items = await prisma.menuItem.findMany({
      where: { restaurant_id: restaurant.id },
      orderBy: { created_at: "desc" }
    });

    return { restaurantId: restaurant.id, items: items ?? [] };
  }),
  route("POST", /^\/api\/hotel\/menu$/, async ({ user, body }) => {
    const restaurant = await prisma.restaurant.findUnique({
      where: { manager_id: user.id },
      select: { id: true }
    });

    if (!restaurant) throw new HttpError(400, "No restaurant assigned");

    const item = await prisma.menuItem.create({
      data: {
        restaurant_id: restaurant.id,
        name: body.name,
        description: body.description ?? null,
        price: body.price,
        category: body.category ?? null,
        image_url: body.image_url ?? null,
        is_available: body.is_available ?? true,
        is_veg: body.is_veg ?? true,
        prep_time_minutes: body.prep_time_minutes ?? 15,
        is_special: body.is_special ?? false,
        modifiers: body.modifiers ?? [],
      }
    });

    return { item };
  }),
  route("PUT", /^\/api\/hotel\/menu\/([^/]+)$/, async ({ match, body }) => {
    const id = decodeURIComponent(match[1]);
    const item = await prisma.menuItem.update({
      where: { id },
      data: body
    });

    return { item };
  }),
  route("DELETE", /^\/api\/hotel\/menu\/([^/]+)$/, async ({ match }) => {
    const id = decodeURIComponent(match[1]);
    await prisma.menuItem.delete({ where: { id } });

    return { ok: true };
  }),
  route("POST", /^\/api\/hotel\/menu\/([^/]+)\/toggle$/, async ({ match, body }) => {
    const id = decodeURIComponent(match[1]);
    const item = await prisma.menuItem.update({
      where: { id },
      data: { is_available: !!body.is_available }
    });

    return { item };
  }),
  route("GET", /^\/api\/hotel\/orders$/, async ({ user }) => {
    const restaurant = await prisma.restaurant.findUnique({
      where: { manager_id: user.id },
      select: { id: true }
    });

    if (!restaurant) {
      return { restaurantId: null, orders: [] };
    }

    const orders = await prisma.foodOrder.findMany({
      where: { restaurant_id: restaurant.id },
      orderBy: { created_at: "desc" },
      include: { items: true }
    });

    // Map Prisma include name to match expected API structure
    const formattedOrders = orders.map(o => ({ ...o, food_order_items: o.items }));

    return {
      restaurantId: restaurant.id,
      orders: await attachUserProfiles(formattedOrders ?? [], { customer: "customer_id" }),
    };
  }),
  route("POST", /^\/api\/hotel\/orders\/([^/]+)\/advance$/, async ({ match, body }) => {
    const id = decodeURIComponent(match[1]);
    const order = await prisma.foodOrder.update({
      where: { id },
      data: { status: body.status }
    });

    return { order };
  }),
  route("POST", /^\/api\/hotel\/orders\/([^/]+)\/reject$/, async ({ match, body }) => {
    const id = decodeURIComponent(match[1]);
    const order = await prisma.foodOrder.update({
      where: { id },
      data: {
        status: "cancelled",
        // cancellation_reason and cancelled_at not in schema
      }
    });

    return { order };
  }),
  route("GET", /^\/api\/hotel\/history$/, async ({ user }) => {
    const restaurant = await prisma.restaurant.findUnique({
      where: { manager_id: user.id },
      select: { id: true }
    });

    if (!restaurant) {
      return { restaurantId: null, orders: [] };
    }

    const orders = await prisma.foodOrder.findMany({
      where: { restaurant_id: restaurant.id },
      orderBy: { created_at: "desc" },
      include: { items: true },
      take: 100
    });

    const formattedOrders = orders.map(o => ({ ...o, food_order_items: o.items }));

    return {
      restaurantId: restaurant.id,
      orders: await attachUserProfiles(formattedOrders ?? [], { customer: "customer_id" }),
    };
  }),
  route("GET", /^\/api\/grocery\/dashboard$/, async ({ user }) => {
    const store = await prisma.groceryStore.findUnique({
      where: { manager_id: user.id }
    });

    if (!store) {
      return { store: null, stats: { total: 0, pending: 0, today: 0 } };
    }

    const orders = await prisma.groceryOrder.findMany({
      where: { store_id: store.id },
      select: { id: true, status: true, created_at: true }
    });

    const today = new Date().toDateString();
    return {
      store,
      stats: {
        total: orders?.length ?? 0,
        pending:
          orders?.filter((order) => ["pending", "accepted", "preparing"].includes(order.status))
            .length ?? 0,
        today:
          orders?.filter((order) => new Date(order.created_at).toDateString() === today).length ??
          0,
      },
    };
  }),
  route("PUT", /^\/api\/grocery\/store$/, async ({ user, body }) => {
    const payload = {
      name: body.name,
      description: body.description ?? null,
      address: body.address ?? null,
      town_name: body.town_name ?? null,
      pincode: body.pincode ?? null,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      image_url: body.image_url ?? null,
      is_open: body.is_open ?? true,
      manager_id: user.id,
    };

    const store = body.id
      ? await prisma.groceryStore.update({
          where: { id: body.id },
          data: payload
        })
      : await prisma.groceryStore.create({
          data: payload
        });

    return { store };
  }),
  route("GET", /^\/api\/grocery\/items$/, async ({ user }) => {
    const store = await prisma.groceryStore.findUnique({
      where: { manager_id: user.id },
      select: { id: true }
    });

    if (!store) {
      return { storeId: null, items: [] };
    }

    const items = await prisma.groceryItem.findMany({
      where: { store_id: store.id },
      orderBy: { created_at: "desc" }
    });

    return { storeId: store.id, items: items ?? [] };
  }),
  route("POST", /^\/api\/grocery\/items$/, async ({ user, body }) => {
    const store = await prisma.groceryStore.findUnique({
      where: { manager_id: user.id },
      select: { id: true }
    });

    if (!store) throw new HttpError(400, "No store assigned");

    const item = await prisma.groceryItem.create({
      data: {
        store_id: store.id,
        name: body.name,
        description: body.description ?? null,
        price: body.price,
        category: body.category ?? null,
        image_url: body.image_url ?? null,
        is_available: body.is_available ?? true,
        stock_quantity: body.stock_quantity ?? 0,
        low_stock_threshold: body.low_stock_threshold ?? 5,
        expiry_date: body.expiry_date ? new Date(body.expiry_date) : null,
        aisle_location: body.aisle_location ?? null,
        unit: body.unit ?? "pcs",
      }
    });

    return { item };
  }),
  route("PUT", /^\/api\/grocery\/items\/([^/]+)$/, async ({ match, body }) => {
    const id = decodeURIComponent(match[1]);
    const item = await prisma.groceryItem.update({
      where: { id },
      data: body
    });

    return { item };
  }),
  route("DELETE", /^\/api\/grocery\/items\/([^/]+)$/, async ({ match }) => {
    const id = decodeURIComponent(match[1]);
    await prisma.groceryItem.delete({ where: { id } });

    return { ok: true };
  }),
  route("POST", /^\/api\/grocery\/items\/([^/]+)\/toggle$/, async ({ match, body }) => {
    const id = decodeURIComponent(match[1]);
    const item = await prisma.groceryItem.update({
      where: { id },
      data: { is_available: !!body.is_available }
    });

    return { item };
  }),
  route("GET", /^\/api\/grocery\/orders$/, async ({ user }) => {
    const store = await prisma.groceryStore.findUnique({
      where: { manager_id: user.id },
      select: { id: true }
    });

    if (!store) {
      return { storeId: null, orders: [] };
    }

    const orders = await prisma.groceryOrder.findMany({
      where: { store_id: store.id },
      orderBy: { created_at: "desc" },
      include: { items: true }
    });

    const formattedOrders = orders.map(o => ({ ...o, grocery_order_items: o.items }));

    return {
      storeId: store.id,
      orders: await attachUserProfiles(formattedOrders ?? [], { customer: "customer_id" }),
    };
  }),
  route("POST", /^\/api\/grocery\/orders\/([^/]+)\/advance$/, async ({ match, body }) => {
    const id = decodeURIComponent(match[1]);
    const order = await prisma.groceryOrder.update({
      where: { id },
      data: { status: body.status }
    });

    return { order };
  }),
  route("GET", /^\/api\/grocery\/history$/, async ({ user }) => {
    const store = await prisma.groceryStore.findUnique({
      where: { manager_id: user.id },
      select: { id: true }
    });

    if (!store) {
      return { storeId: null, orders: [] };
    }

    const orders = await prisma.groceryOrder.findMany({
      where: { store_id: store.id },
      orderBy: { created_at: "desc" },
      include: { items: true },
      take: 100
    });

    const formattedOrders = orders.map(o => ({ ...o, grocery_order_items: o.items }));

    return {
      storeId: store.id,
      orders: await attachUserProfiles(formattedOrders ?? [], { customer: "customer_id" }),
    };
  }),
  route("GET", /^\/api\/delivery\/available$/, async () => {
    const [food, grocery] = await Promise.all([
      prisma.foodOrder.findMany({
        where: { delivery_boy_id: null, status: { in: ["ready", "preparing"] } },
        orderBy: { created_at: "desc" },
        include: { restaurant: { select: { name: true } } }
      }),
      prisma.groceryOrder.findMany({
        where: { delivery_boy_id: null, status: { in: ["ready", "preparing"] } },
        orderBy: { created_at: "desc" },
        include: { store: { select: { name: true } } }
      }),
    ]);

    const formatFood = (list) => list.map(o => ({ ...o, restaurants: o.restaurant }));
    const formatGrocery = (list) => list.map(o => ({ ...o, grocery_stores: o.store }));

    return {
      food: await attachUserProfiles(formatFood(food ?? []), { customer: "customer_id" }),
      grocery: await attachUserProfiles(formatGrocery(grocery ?? []), { customer: "customer_id" }),
    };
  }),
  route("GET", /^\/api\/delivery\/active$/, async ({ user }) => {
    const [food, grocery] = await Promise.all([
      prisma.foodOrder.findMany({
        where: { delivery_boy_id: user.id },
        orderBy: { created_at: "desc" },
        include: { restaurant: { select: { name: true } } }
      }),
      prisma.groceryOrder.findMany({
        where: { delivery_boy_id: user.id },
        orderBy: { created_at: "desc" },
        include: { store: { select: { name: true } } }
      }),
    ]);

    const formatFood = (list) => list.map(o => ({ ...o, restaurants: o.restaurant }));
    const formatGrocery = (list) => list.map(o => ({ ...o, grocery_stores: o.store }));

    const hydratedFood = await attachUserProfiles(formatFood(food ?? []), { customer: "customer_id" });
    const hydratedGrocery = await attachUserProfiles(formatGrocery(grocery ?? []), { customer: "customer_id" });

    const normalize = (order) => ({
      ...normalizeDeliveryOrder(order),
      profiles: order.customer || null,
    });

    return {
      food: hydratedFood.map(normalize),
      grocery: hydratedGrocery.map(normalize),
    };
  }),
  route(
    "POST",
    /^\/api\/delivery\/(food|grocery)\/([^/]+)\/accept$/,
    async ({ user, match }) => {
      const kind = match[1];
      const id = decodeURIComponent(match[2]);
      const modelName = kind === "food" ? "foodOrder" : "groceryOrder";

      const order = await prisma[modelName].update({
        where: { id, delivery_boy_id: null },
        data: { delivery_boy_id: user.id }
      }).catch(() => {
        throw new HttpError(404, "Delivery not found or already assigned");
      });

      return { order: normalizeDeliveryOrder(order) };
    },
  ),
  route(
    "POST",
    /^\/api\/delivery\/(food|grocery)\/([^/]+)\/advance$/,
    async ({ match, body }) => {
      const kind = match[1];
      const id = decodeURIComponent(match[2]);
      const modelName = kind === "food" ? "foodOrder" : "groceryOrder";

      const current = await prisma[modelName].findUnique({
        where: { id }
      });
      if (!current) throw new HttpError(404, "Delivery not found or you are not assigned to it");

      verifyStatusAdvance("delivery", current.status, body.status);

      if (body.status === "delivered") {
        verifyDeliveryPin(current, body.delivery_pin);
      }

      const data = { status: body.status };
      if (body.status === "delivered") {
        data.payment_status = "paid";
      }

      const order = await prisma[modelName].update({
        where: { id },
        data
      });

      return { order: normalizeDeliveryOrder(order) };
    },
  ),
  route("GET", /^\/api\/delivery\/history$/, async ({ user }) => {
    const [food, grocery] = await Promise.all([
      prisma.foodOrder.findMany({
        where: { delivery_boy_id: user.id, status: { in: ["delivered", "completed", "cancelled"] } },
        orderBy: { created_at: "desc" },
        include: { restaurant: { select: { name: true } } },
        take: 100
      }),
      prisma.groceryOrder.findMany({
        where: { delivery_boy_id: user.id, status: { in: ["delivered", "completed", "cancelled"] } },
        orderBy: { created_at: "desc" },
        include: { store: { select: { name: true } } },
        take: 100
      }),
    ]);

    const formatFood = (list) => list.map(o => ({ ...o, restaurants: o.restaurant }));
    const formatGrocery = (list) => list.map(o => ({ ...o, grocery_stores: o.store }));

    return { food: formatFood(food ?? []), grocery: formatGrocery(grocery ?? []) };
  }),
  route("GET", /^\/api\/rider\/jobs$/, async ({ user }) => {
    const [rides, packages] = await Promise.all([
      prisma.ride.findMany({
        where: {
          OR: [{ rider_id: null }, { rider_id: user.id }],
          status: { notIn: ["completed", "cancelled"] }
        },
        orderBy: { created_at: "desc" }
      }),
      prisma.packageDelivery.findMany({
        where: {
          OR: [{ rider_id: null }, { rider_id: user.id }],
          status: { notIn: ["completed", "cancelled"] }
        },
        orderBy: { created_at: "desc" }
      }),
    ]);

    return {
      rides: await attachUserProfiles(rides ?? [], { customer: "customer_id" }),
      packages: await attachUserProfiles(packages ?? [], { customer: "customer_id" }),
    };
  }),
  route("GET", /^\/api\/rider\/active$/, async ({ user, url }) => {
    const id = url.searchParams.get("id");
    const kind = url.searchParams.get("kind");
    const models =
      kind === "package"
        ? ["packageDelivery"]
        : kind === "ride"
          ? ["ride"]
          : ["ride", "packageDelivery"];

    for (const modelName of models) {
      const job = await prisma[modelName].findFirst({
        where: id ? { id } : {
          rider_id: user.id,
          status: { notIn: ["completed", "cancelled"] }
        },
        orderBy: { created_at: "desc" }
      });

      if (job) {
        return {
          job: await attachUserProfiles(job, { customer: "customer_id" }),
          table: modelName === "ride" ? "rides" : "package_deliveries",
        };
      }
    }

    return { job: null, table: "rides" };
  }),
  route("POST", /^\/api\/rider\/rides\/([^/]+)\/accept$/, async ({ user, match }) => {
    const id = decodeURIComponent(match[1]);
    const ride = await prisma.ride.update({
      where: { id, rider_id: null },
      data: { rider_id: user.id, status: "accepted" }
    });

    return { ride };
  }),
  route("POST", /^\/api\/rider\/packages\/([^/]+)\/accept$/, async ({ user, match }) => {
    const id = decodeURIComponent(match[1]);
    const packageDelivery = await prisma.packageDelivery.update({
      where: { id, rider_id: null },
      data: { rider_id: user.id, status: "accepted" }
    });

    return { packageDelivery };
  }),
  route(
    "POST",
    /^\/api\/rider\/(rides|package_deliveries)\/([^/]+)\/advance$/,
    async ({ match, body }) => {
      const table = match[1];
      const id = decodeURIComponent(match[2]);
      const modelName = table === "rides" ? "ride" : "packageDelivery";

      const current = await prisma[modelName].findUnique({
        where: { id }
      });
      if (!current) throw new HttpError(404, "Job not found");

      verifyStatusAdvance(table === "rides" ? "ride" : "package", current.status, body.status);

      if (body.status === "completed") {
        verifyDeliveryPin(current, body.delivery_pin);
      }

      const job = await prisma[modelName].update({
        where: { id },
        data: { status: body.status }
      });

      return { job };
    },
  ),
  route(
    "POST",
    /^\/api\/rider\/(rides|package_deliveries)\/([^/]+)\/cancel$/,
    async ({ match }) => {
      const table = match[1];
      const id = decodeURIComponent(match[2]);
      const modelName = table === "rides" ? "ride" : "packageDelivery";

      const job = await prisma[modelName].update({
        where: { id },
        data: { status: "cancelled", rider_id: null }
      });

      return { job };
    },
  ),
  route("GET", /^\/api\/rider\/history$/, async ({ user }) => {
    const [rides, packages] = await Promise.all([
      prisma.ride.findMany({
        where: { rider_id: user.id },
        orderBy: { created_at: "desc" },
        take: 100
      }),
      prisma.packageDelivery.findMany({
        where: { rider_id: user.id },
        orderBy: { created_at: "desc" },
        take: 100
      }),
    ]);

    return {
      rides: await attachUserProfiles(rides ?? [], { customer: "customer_id" }),
      packages: await attachUserProfiles(packages ?? [], { customer: "customer_id" }),
    };
  }),
  route("GET", /^\/api\/admin\/commissions$/, async () => ({
    commissions: await getPlatformCommissions(),
  })),
  route("PUT", /^\/api\/admin\/commissions$/, async ({ body }) => {
    const value = {
      restaurant: Number(body.restaurant ?? DEFAULT_COMMISSIONS.restaurant),
      grocery: Number(body.grocery ?? DEFAULT_COMMISSIONS.grocery),
      delivery: Number(body.delivery ?? DEFAULT_COMMISSIONS.delivery),
    };
    const saved = await savePlatformCommissions(value);
    return { commissions: saved };
  }),
  route("GET", /^\/api\/admin\/catalog-settings$/, async () => ({
    radius_km: await getCatalogRadiusKm(),
    limits: {
      min_km: MIN_CATALOG_RADIUS_KM,
      max_km: MAX_CATALOG_RADIUS_KM,
      default_km: DEFAULT_CATALOG_RADIUS_KM,
    },
  })),
  route("PUT", /^\/api\/admin\/catalog-settings$/, async ({ body }) => {
    const requested = Number(body?.radius_km);
    if (!Number.isFinite(requested)) {
      throw new HttpError(400, "radius_km must be a number");
    }
    if (requested < MIN_CATALOG_RADIUS_KM || requested > MAX_CATALOG_RADIUS_KM) {
      throw new HttpError(
        400,
        `radius_km must be between ${MIN_CATALOG_RADIUS_KM} and ${MAX_CATALOG_RADIUS_KM}`,
      );
    }

    const saved = await saveCatalogRadiusKm(requested);
    return {
      radius_km: saved,
      limits: {
        min_km: MIN_CATALOG_RADIUS_KM,
        max_km: MAX_CATALOG_RADIUS_KM,
        default_km: DEFAULT_CATALOG_RADIUS_KM,
      },
    };
  }),
  route("POST", /^\/api\/reviews$/, async ({ user, body }) => {
    const payload = {
      service_kind: body.service_kind,
      service_id: body.service_id,
      rating: body.rating != null ? Number(body.rating) : undefined,
      comment: body.comment || undefined,
    };
    const parsed = reviewSchema.safeParse(payload);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid inputs");
    }
    const { service_kind: serviceKind, service_id: serviceId, rating, comment } = parsed.data;

    const review = await prisma.orderReview.create({
      data: {
        user_id: user.id,
        service_kind: serviceKind,
        service_id: serviceId,
        rating,
        comment: sanitizeComment(comment),
      }
    });

    return { review };
  }),
  route("GET", /^\/api\/reviews\/([^/]+)\/([^/]+)$/, async ({ match }) => {
    const serviceKind = match[1];
    const serviceId = decodeURIComponent(match[2]);
    const reviews = await prisma.orderReview.findMany({
      where: {
        service_kind: serviceKind,
        service_id: serviceId
      },
      orderBy: { created_at: "desc" },
      take: 20
    });
    return { reviews: reviews ?? [] };
  }),
  route("GET", /^\/api\/delivery\/earnings$/, async ({ user }) => {
    const [food, grocery] = await Promise.all([
      prisma.foodOrder.findMany({
        where: { delivery_boy_id: user.id, status: "delivered" },
        select: { total: true, created_at: true }
      }),
      prisma.groceryOrder.findMany({
        where: { delivery_boy_id: user.id, status: "delivered" },
        select: { total: true, created_at: true }
      }),
    ]);
    const orders = [...(food ?? []), ...(grocery ?? [])];
    const todayStart = startOfLocalDay();
    const monthStart = startOfLocalMonth();
    const today = orders.filter((o) => isOnOrAfter(o.created_at, todayStart));
    const month = orders.filter((o) => isOnOrAfter(o.created_at, monthStart));
    const sum = (list) => list.reduce((acc, o) => acc + money(o.total), 0);

    return {
      todayEarnings: sum(today),
      monthEarnings: sum(month),
      totalDeliveries: orders.length,
    };
  }),
  route("GET", /^\/api\/rider\/earnings$/, async ({ user }) => {
    const [rides, packages] = await Promise.all([
      prisma.ride.findMany({
        where: { rider_id: user.id, status: "completed" },
        select: { fare_estimate: true, created_at: true }
      }),
      prisma.packageDelivery.findMany({
        where: { rider_id: user.id, status: "completed" },
        select: { fare_estimate: true, created_at: true }
      }),
    ]);
    const jobs = [...(rides ?? []), ...(packages ?? [])];
    const todayStart = startOfLocalDay();
    const monthStart = startOfLocalMonth();
    const today = jobs.filter((j) => isOnOrAfter(j.created_at, todayStart));
    const month = jobs.filter((j) => isOnOrAfter(j.created_at, monthStart));
    const sum = (list) => list.reduce((acc, j) => acc + money(j.fare_estimate), 0);

    return {
      todayEarnings: sum(today),
      monthEarnings: sum(month),
      totalJobs: jobs.length,
    };
  }),
  route("GET", /^\/api\/grocery\/alerts$/, async ({ user }) => {
    const store = await prisma.groceryStore.findUnique({
      where: { manager_id: user.id },
      select: { id: true }
    });
    if (!store) return { lowStock: [], expiringSoon: [] };

    const items = await prisma.groceryItem.findMany({
      where: { store_id: store.id },
      select: { id: true, name: true, stock_quantity: true, low_stock_threshold: true, expiry_date: true, is_available: true }
    });

    const today = new Date();
    const weekAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

    const lowStock = (items ?? []).filter((item) => {
      const stock = Number(item.stock_quantity ?? 0);
      const threshold = Number(item.low_stock_threshold ?? 5);
      return item.is_available !== false && stock <= threshold;
    });

    const expiringSoon = (items ?? []).filter((item) => {
      if (!item.expiry_date) return false;
      const expiry = new Date(item.expiry_date);
      return expiry >= today && expiry <= weekAhead;
    });

    return { lowStock, expiringSoon };
  }),
];

async function matchApiRoute(req, url) {
  const method = req.method === "HEAD" ? "GET" : req.method;

  for (const entry of routes) {
    if (entry.method !== method) continue;
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

  const authMethod = req.method === "HEAD" ? "GET" : (req.method || "GET");
  const isPublic = isPublicApiRoute(authMethod, url.pathname);
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

async function mainHandler(req, res) {
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

    if (process.env.LAMBDA_TASK_ROOT) {
       throw new HttpError(404, "Not Found");
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
}

async function checkDatabaseConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("Database connected successfully.");
    return true;
  } catch (error) {
    console.error(
      "Database connection failed:",
      error instanceof Error ? error.message : String(error),
    );
    console.error("Database not connected. Please check DATABASE_URL and your database server.");
    return false;
  }
}

async function checkDatabaseSchema() {
  try {
    const result = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema IN ('rweezy', 'public')
          AND table_name = 'users'
      ) AS exists
    `;

    const exists = Array.isArray(result) ? result[0]?.exists : false;
    if (!exists) {
      console.error("Database connected, but Rweezy tables were not found.");
      console.error("Run the Prisma migrations or push the schema:");
      console.error("  cd backend && npx prisma migrate dev");
      console.error("  OR cd backend && npx prisma db push --schema=backend/prisma/schema.prisma");
      return false;
    }

    console.log("Rweezy database schema detected.");
    return true;
  } catch (error) {
    console.error("Database schema check failed:", error instanceof Error ? error.message : String(error));
    return false;
  }
}

const server = http.createServer(mainHandler);

export const handler = serverless(server);

if (!process.env.LAMBDA_TASK_ROOT) {
  (async () => {
    const connected = await checkDatabaseConnection();
    const schemaReady = connected && await checkDatabaseSchema();

    if (!connected || !schemaReady) {
      process.exit(1);
    }

    server.listen(env.port, env.host, () => {
      console.log(`Backend listening on http://${env.host}:${env.port}`);
      warmupBaileys().catch((error) => {
        logEvent("warn", "baileys_warmup_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  })();
}
