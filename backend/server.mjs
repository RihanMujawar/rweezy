import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
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
  findUserEmailByPhone,
  getUserFromToken,
  refreshAuthSession,
  restRequest,
  revokeSession,
  serviceRoleRestRequest,
  signInWithPassword,
} from "./lib/supabase.mjs";
import { checkRateLimit } from "./lib/rate-limit.mjs";
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

async function getChatContext(token, user, kind, serviceId) {
  const normalizedKind = normalizeChatKind(kind);
  if (!normalizedKind) {
    throw new HttpError(400, "Invalid chat type");
  }

  const target = chatTarget(normalizedKind);
  const rows = await restRequest(
    token,
    buildPath(`/${target.table}`, {
      select: `id,customer_id,${target.partnerColumn}`,
      id: `eq.${serviceId}`,
      limit: "1",
    }),
  );
  const row = firstRow(rows);

  if (!row) {
    throw new HttpError(404, "Chat target not found");
  }

  if (isChatParticipant(user.id, row, target.partnerColumn)) {
    return { kind: normalizedKind, row, partnerColumn: target.partnerColumn };
  }

  const roles = await getRoles(token, user.id);
  if (!roles.includes("admin")) {
    throw new HttpError(403, "You do not have access to this chat");
  }

  return { kind: normalizedKind, row, partnerColumn: target.partnerColumn };
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

async function getPlatformCommissions(token) {
  try {
    const rows = await restRequest(
      token,
      buildPath("/platform_settings", { select: "value", key: "eq.commissions", limit: "1" }),
    );
    const row = firstRow(rows);
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

async function savePlatformCommissions(token, value) {
  const rows = await restRequest(
    token,
    buildPath("/platform_settings", { select: "key,value", key: "eq.commissions", limit: "1" }),
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: { key: "commissions", value },
    },
  );
  return firstRow(rows)?.value ?? value;
}

async function deductGroceryStock(token, storeId, items) {
  const groceryRows = await restRequest(
    token,
    buildPath("/grocery_items", {
      select: "id,stock_quantity",
      store_id: `eq.${storeId}`,
      id: `in.(${items.map((item) => item.id).join(",")})`,
    }),
  );
  const stockById = new Map(
    (groceryRows ?? []).map((row) => [row.id, Number(row.stock_quantity ?? 0)]),
  );

  for (const item of items) {
    const current = stockById.get(item.id);
    if (current === undefined) continue;
    if (current < item.quantity) {
      throw new HttpError(400, `${item.name} only has ${current} in stock`);
    }
    await restRequest(token, buildPath("/grocery_items", { id: `eq.${item.id}` }), {
      method: "PATCH",
      body: { stock_quantity: current - item.quantity },
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
    await restRequest(token, "/audit_events", {
      method: "POST",
      body: {
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

async function getRoles(token, userId) {
  const rows = await restRequest(
    token,
    buildPath("/user_roles", {
      select: "role",
      user_id: `eq.${userId}`,
    }),
  );

  return (rows ?? []).map((row) => row.role);
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
  route("GET", /^\/api\/admin\/health$/, async ({ token }) => {
    const [pendingRoles, foodPending, groceryPending, unassignedFood] = await Promise.all([
      restRequest(
        token,
        buildPath("/role_requests", { select: "id", status: "eq.pending", limit: "50" }),
      ).catch(() => []),
      restRequest(
        token,
        buildPath("/food_orders", {
          select: "id",
          status: "in.(pending,accepted,preparing)",
          delivery_boy_id: "is.null",
          limit: "50",
        }),
      ).catch(() => []),
      restRequest(
        token,
        buildPath("/grocery_orders", {
          select: "id",
          status: "in.(pending,accepted,preparing)",
          delivery_boy_id: "is.null",
          limit: "50",
        }),
      ).catch(() => []),
      restRequest(
        token,
        buildPath("/food_orders", {
          select: "id",
          status: "eq.ready",
          delivery_boy_id: "is.null",
          limit: "50",
        }),
      ).catch(() => []),
    ]);

    return {
      pendingRoleRequests: pendingRoles?.length ?? 0,
      foodOrdersNeedingAttention: foodPending?.length ?? 0,
      groceryOrdersNeedingAttention: groceryPending?.length ?? 0,
      readyFoodWithoutRider: unassignedFood?.length ?? 0,
    };
  }),
  route("POST", /^\/api\/auth\/login$/, async ({ body }) => {
    const email = cleanText(body.email);
    const phone = normalizeIndianPhone(body.phone);
    let identifier = { email };

    if (phone) {
      let foundEmail = null;

      try {
        const rows = await serviceRoleRestRequest("/rpc/email_for_phone_login", {
          method: "POST",
          body: { lookup_phone: phone },
        });
        foundEmail = typeof rows === "string" ? rows : null;
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 404) {
          throw error;
        }
      }

      if (!foundEmail) {
        foundEmail = await findUserEmailByPhone(phone);
      }

      if (!foundEmail) {
        throw new HttpError(401, "No account found for this phone number");
      }
      identifier = { email: foundEmail };
    }

    if (!identifier.email) {
      throw new HttpError(400, "Email or phone is required");
    }

    const session = await signInWithPassword(identifier, body.password);
    const normalized = normalizeAuthSession(session);

    if (!normalized.user) {
      throw new HttpError(401, "Unable to sign in");
    }

    const roles = normalized.accessToken
      ? await getRoles(normalized.accessToken, normalized.user.id)
      : [];

    return {
      user: normalized.user,
      roles,
      __responseHeaders: {
        "Set-Cookie": buildSessionCookies(session),
      },
    };
  }),
  route("POST", /^\/api\/auth\/register$/, async ({ body }) => {
    const { email, fullName, password, phone } = validateRegistration(body);
    const requestedRole = normalizeBusinessRole(body.requested_role);
    const role = "customer";

    const createdUser = await createConfirmedUserWithPassword(email, password, fullName, {
      role,
      phone,
      requested_role: requestedRole,
    });
    const createdUserId = createdUser?.id ?? createdUser?.user?.id;

    if (!createdUserId) {
      throw new HttpError(500, "Account was created but no user id was returned");
    }

    await serviceRoleRestRequest(buildPath("/profiles", { on_conflict: "id" }), {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: {
        id: createdUserId,
        full_name: fullName,
        phone,
      },
    });

    await serviceRoleRestRequest(buildPath("/user_roles", { on_conflict: "user_id,role" }), {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates" },
      body: {
        user_id: createdUserId,
        role,
      },
    });

    let roleRequestPending = false;
    let roleRequestWarning = null;

    if (requestedRole) {
      try {
        await serviceRoleRestRequest("/role_requests", {
          method: "POST",
          body: {
            user_id: createdUserId,
            requested_role: requestedRole,
            business_name: cleanText(body.business_name) || null,
            message: cleanText(body.role_message) || "Requested during registration",
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

    const session = await signInWithPassword({ email }, password);
    const normalized = normalizeAuthSession(session);
    const roles =
      normalized.accessToken && normalized.user
        ? await getRoles(normalized.accessToken, normalized.user.id)
        : [];

    return {
      user: normalized.user,
      roles,
      authenticated: Boolean(normalized.accessToken),
      roleRequestPending,
      roleRequestWarning,
      __responseHeaders: {
        "Set-Cookie": buildSessionCookies(session),
      },
    };
  }),
  route("POST", /^\/api\/auth\/logout$/, async ({ req }) => {
    const bearerToken = getBearerToken(req);
    const cookies = parseCookies(req);
    const accessToken = bearerToken || cookies[ACCESS_COOKIE];

    if (accessToken) {
      await revokeSession(accessToken);
    }

    return {
      ok: true,
      __responseHeaders: {
        "Set-Cookie": clearSessionCookies(),
      },
    };
  }),
  route("GET", /^\/api\/auth\/me$/, async ({ token, user }) => {
    const roles = await getRoles(token, user.id);
    return { user, roles };
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
  route("GET", /^\/api\/profile$/, async ({ token, user }) => {
    const rows = await restRequest(
      token,
      buildPath("/profiles", {
        select: "*",
        id: `eq.${user.id}`,
      }),
    );

    return { profile: firstRow(rows) };
  }),
  route("GET", /^\/api\/profile\/addresses$/, async ({ token, user }) => {
    const rows = await restRequest(
      token,
      buildPath("/saved_addresses", {
        select: "*",
        user_id: `eq.${user.id}`,
        order: "is_default.desc,created_at.desc",
      }),
    );

    return { addresses: rows ?? [] };
  }),
  route("POST", /^\/api\/profile\/addresses$/, async ({ token, user, body }) => {
    const rows = await restRequest(token, buildPath("/saved_addresses", { select: "*" }), {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        user_id: user.id,
        label: requireText(body.label || "Saved address", "Address label", 80),
        address: requireText(body.address, "Address", 300),
        lat: body.lat == null ? null : requireNumber(body.lat, "Latitude"),
        lng: body.lng == null ? null : requireNumber(body.lng, "Longitude"),
        is_default: !!body.is_default,
      },
    });

    return { address: firstRow(rows) };
  }),
  route("DELETE", /^\/api\/profile\/addresses\/([^/]+)$/, async ({ token, match }) => {
    const id = decodeURIComponent(match[1]);
    await restRequest(token, buildPath("/saved_addresses", { id: `eq.${id}` }), {
      method: "DELETE",
    });
    return { ok: true };
  }),
  route("PUT", /^\/api\/profile$/, async ({ token, user, body }) => {
    const rows = await restRequest(
      token,
      buildPath("/profiles", {
        id: `eq.${user.id}`,
        select: "*",
      }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: {
          full_name: body.full_name ?? "",
          phone: body.phone ?? "",
        },
      },
    );

    return { profile: firstRow(rows) };
  }),
  route("GET", /^\/api\/role-requests$/, async ({ token, user }) => {
    const rows = await restRequest(
      token,
      buildPath("/role_requests", {
        select: "*",
        user_id: `eq.${user.id}`,
        order: "created_at.desc",
      }),
    );

    return { requests: rows ?? [] };
  }),
  route("POST", /^\/api\/role-requests$/, async ({ token, user, body }) => {
    const requestedRole = normalizeBusinessRole(body.requested_role);
    if (!requestedRole) throw new HttpError(400, "Choose a valid role to request");

    const rows = await restRequest(token, buildPath("/role_requests", { select: "*" }), {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        user_id: user.id,
        requested_role: requestedRole,
        business_name: cleanText(body.business_name) || null,
        message: cleanText(body.message) || null,
      },
    });

    return { request: firstRow(rows) };
  }),
  route("POST", /^\/api\/live-location$/, async ({ token, body }) => {
    const allowedTables = new Set(["rides", "package_deliveries", "food_orders", "grocery_orders"]);

    if (!allowedTables.has(body.table)) {
      throw new HttpError(400, "Invalid live location target");
    }

    const rows = await restRequest(
      token,
      buildPath(`/${body.table}`, {
        id: `eq.${body.row_id}`,
        select: "*",
      }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: {
          rider_lat: body.rider_lat,
          rider_lng: body.rider_lng,
          rider_location_updated_at: new Date().toISOString(),
        },
      },
    );

    return { row: firstRow(rows) };
  }),
  route("GET", /^\/api\/catalog\/restaurants$/, async ({ token }) => {
    const restaurants = await restRequest(
      token,
      buildPath("/restaurants", {
        select: "*",
        order: "created_at.desc",
      }),
    );

    return { restaurants: restaurants ?? [], location: null };
  }),
  route("GET", /^\/api\/catalog\/restaurants\/([^/]+)$/, async ({ token, match }) => {
    const restaurantId = decodeURIComponent(match[1]);
    const [restaurantRows, itemRows] = await Promise.all([
      restRequest(
        token,
        buildPath("/restaurants", {
          select: "*",
          id: `eq.${restaurantId}`,
        }),
      ),
      restRequest(
        token,
        buildPath("/menu_items", {
          select: "*",
          restaurant_id: `eq.${restaurantId}`,
          is_available: "eq.true",
          order: "category.asc",
        }),
      ),
    ]);

    return {
      restaurant: firstRow(restaurantRows),
      items: itemRows ?? [],
    };
  }),
  route("GET", /^\/api\/catalog\/items\/food$/, async ({ token }) => {
    const items = await restRequest(
      token,
      buildPath("/menu_items", {
        select: "id,name,description,price,image_url,category,is_available,restaurant_id,restaurants(name)",
        is_available: "eq.true",
        limit: "12",
      }),
    );
    return { items: items ?? [] };
  }),
  route("GET", /^\/api\/catalog\/items\/grocery$/, async ({ token }) => {
    const items = await restRequest(
      token,
      buildPath("/grocery_items", {
        select: "id,name,description,price,image_url,category,is_available,store_id,grocery_stores(name)",
        is_available: "eq.true",
        limit: "12",
      }),
    );
    return { items: items ?? [] };
  }),
  route("GET", /^\/api\/catalog\/stores$/, async ({ token }) => {
    const stores = await restRequest(
      token,
      buildPath("/grocery_stores", {
        select: "*",
        order: "created_at.desc",
      }),
    );

    return { stores: stores ?? [], location: null };
  }),
  route("GET", /^\/api\/catalog\/stores\/([^/]+)$/, async ({ token, match }) => {
    const storeId = decodeURIComponent(match[1]);
    const [storeRows, itemRows] = await Promise.all([
      restRequest(
        token,
        buildPath("/grocery_stores", {
          select: "*",
          id: `eq.${storeId}`,
        }),
      ),
      restRequest(
        token,
        buildPath("/grocery_items", {
          select: "*",
          store_id: `eq.${storeId}`,
          is_available: "eq.true",
          order: "category.asc",
        }),
      ),
    ]);

    return {
      store: firstRow(storeRows),
      items: itemRows ?? [],
    };
  }),
  route("POST", /^\/api\/orders\/food$/, async ({ token, user, body }) => {
    const items = validateCartItems(body.items);
    const restaurantRows = await restRequest(
      token,
      buildPath("/restaurants", {
        select: "id,name,address,town_name,pincode,lat,lng,is_open",
        id: `eq.${body.restaurant_id}`,
        limit: "1",
      }),
    );
    const restaurant = firstRow(restaurantRows);
    if (!restaurant || restaurant.is_open === false) {
      throw new HttpError(400, "This restaurant is not accepting orders right now");
    }

    const menuRows = await restRequest(
      token,
      buildPath("/menu_items", {
        select: "id,name,price,is_available,prep_time_minutes",
        restaurant_id: `eq.${body.restaurant_id}`,
        id: `in.(${items.map((item) => item.id).join(",")})`,
      }),
    );
    const menuById = new Map((menuRows ?? []).map((item) => [item.id, item]));
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

    const orderRows = await restRequest(token, buildPath("/food_orders", { select: "*" }), {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
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
      },
    });

    const order = firstRow(orderRows);
    if (!order) {
      throw new HttpError(500, "Failed to create food order");
    }

    const orderItems = items.map((item) => ({
      order_id: order.id,
      menu_item_id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    }));

    if (orderItems.length > 0) {
      await restRequest(token, "/food_order_items", {
        method: "POST",
        body: orderItems,
      });
    }

    return { order };
  }),
  route("POST", /^\/api\/orders\/grocery$/, async ({ token, user, body }) => {
    const items = validateCartItems(body.items);
    const storeRows = await restRequest(
      token,
      buildPath("/grocery_stores", {
        select: "id,name,address,town_name,pincode,lat,lng,is_open",
        id: `eq.${body.store_id}`,
        limit: "1",
      }),
    );
    const store = firstRow(storeRows);
    if (!store || store.is_open === false) {
      throw new HttpError(400, "This store is not accepting orders right now");
    }

    const groceryRows = await restRequest(
      token,
      buildPath("/grocery_items", {
        select: "id,name,price,is_available,stock_quantity",
        store_id: `eq.${body.store_id}`,
        id: `in.(${items.map((item) => item.id).join(",")})`,
      }),
    );
    const groceryById = new Map((groceryRows ?? []).map((item) => [item.id, item]));
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

    const orderRows = await restRequest(token, buildPath("/grocery_orders", { select: "*" }), {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
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
      },
    });

    const order = firstRow(orderRows);
    if (!order) {
      throw new HttpError(500, "Failed to create grocery order");
    }

    try {
      await deductGroceryStock(token, body.store_id, items);
    } catch (error) {
      if (!isMissingTableError(error, "grocery_items")) throw error;
    }

    const orderItems = items.map((item) => ({
      order_id: order.id,
      grocery_item_id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    }));

    if (orderItems.length > 0) {
      await restRequest(token, "/grocery_order_items", {
        method: "POST",
        body: orderItems,
      });
    }

    return { order };
  }),
  route("GET", /^\/api\/orders\/me$/, async ({ token, user }) => {
    const [food, grocery, rides, packages] = await Promise.all([
      restRequest(
        token,
        buildPath("/food_orders", {
          select:
            "id,status,total,delivery_address,created_at,rider_id:delivery_boy_id,payment_method,restaurants(name)",
          customer_id: `eq.${user.id}`,
          order: "created_at.desc",
        }),
      ),
      restRequest(
        token,
        buildPath("/grocery_orders", {
          select:
            "id,status,total,delivery_address,created_at,rider_id:delivery_boy_id,payment_method,grocery_stores(name)",
          customer_id: `eq.${user.id}`,
          order: "created_at.desc",
        }),
      ),
      restRequest(
        token,
        buildPath("/rides", {
          select:
            "id,status,fare_estimate,pickup_address,drop_address,created_at,rider_id,vehicle_type,payment_method",
          customer_id: `eq.${user.id}`,
          order: "created_at.desc",
        }),
      ),
      restRequest(
        token,
        buildPath("/package_deliveries", {
          select:
            "id,status,fare_estimate,pickup_address,drop_address,created_at,rider_id,package_size,payment_method",
          customer_id: `eq.${user.id}`,
          order: "created_at.desc",
        }),
      ),
    ]);

    return {
      food: food ?? [],
      grocery: grocery ?? [],
      rides: rides ?? [],
      packages: packages ?? [],
    };
  }),
  route(
    "POST",
    /^\/api\/orders\/(ride|package|food|grocery)\/([^/]+)\/cancel$/,
    async ({ token, user, match, body }) => {
      const kind = match[1];
      const id = decodeURIComponent(match[2]);
      const table = {
        ride: "rides",
        package: "package_deliveries",
        food: "food_orders",
        grocery: "grocery_orders",
      }[kind];

      const currentRows = await restRequest(
        token,
        buildPath(`/${table}`, {
          select: "id,status,customer_id",
          id: `eq.${id}`,
          customer_id: `eq.${user.id}`,
          limit: "1",
        }),
      );
      const current = firstRow(currentRows);
      assertCancellable(current, kind);

      const rows = await restRequest(
        token,
        buildPath(`/${table}`, { id: `eq.${id}`, customer_id: `eq.${user.id}`, select: "*" }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: {
            status: "cancelled",
            cancellation_reason: cleanText(body.reason) || "Cancelled by customer",
            cancelled_at: new Date().toISOString(),
          },
        },
      );

      return { row: firstRow(rows) };
    },
  ),
  route("GET", /^\/api\/track\/(ride|package|food|grocery)\/([^/]+)$/, async ({ token, match }) => {
    const kind = match[1];
    const id = decodeURIComponent(match[2]);
    const table = {
      ride: "rides",
      package: "package_deliveries",
      food: "food_orders",
      grocery: "grocery_orders",
    }[kind];

    const rows = await restRequest(
      token,
      buildPath(`/${table}`, {
        select: "*",
        id: `eq.${id}`,
      }),
    );

    const row = firstRow(rows);
    const normalizedRow = kind === "food" || kind === "grocery" ? normalizeDeliveryOrder(row) : row;
    let partner = null;
    if (normalizedRow?.rider_id) {
      const profileRows = await restRequest(
        token,
        buildPath("/profiles", {
          select: "id,full_name,phone",
          id: `eq.${normalizedRow.rider_id}`,
          limit: "1",
        }),
      );
      partner = firstRow(profileRows);
    }

    return {
      row: normalizedRow ? { ...normalizedRow, partner } : null,
    };
  }),
  route(
    "GET",
    /^\/api\/chat\/(ride|package|food|grocery)\/([^/]+)$/,
    async ({ token, user, match }) => {
      const kind = match[1];
      const serviceId = decodeURIComponent(match[2]);
      const context = await getChatContext(token, user, kind, serviceId);

      const messages = await restRequest(
        token,
        buildPath("/chat_messages", {
          select: "id,service_kind,service_id,sender_id,body,created_at",
          service_kind: `eq.${context.kind}`,
          service_id: `eq.${serviceId}`,
          order: "created_at.asc",
          limit: "100",
        }),
      );

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
    async ({ token, user, match, body }) => {
      const kind = match[1];
      const serviceId = decodeURIComponent(match[2]);
      await getChatContext(token, user, kind, serviceId);

      const messageBody = cleanText(body.message);
      if (!messageBody) {
        throw new HttpError(400, "Message is required");
      }

      if (messageBody.length > 1000) {
        throw new HttpError(400, "Message is too long");
      }

      const rows = await restRequest(token, buildPath("/chat_messages", { select: "*" }), {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          service_kind: kind,
          service_id: serviceId,
          sender_id: user.id,
          body: messageBody,
        },
      });

      return { message: firstRow(rows) };
    },
  ),
  route("POST", /^\/api\/rides$/, async ({ token, user, body }) => {
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
    const rows = await restRequest(token, buildPath("/rides", { select: "*" }), {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        customer_id: user.id,
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        pickup_address: pickupAddress,
        drop_lat: dropLat,
        drop_lng: dropLng,
        drop_address: dropAddress,
        fare_estimate: fareEstimate,
        vehicle_type: body.vehicle_type,
        notes: body.notes || null,
        payment_method: body.payment_method || "cash",
        delivery_pin: deliveryPin,
        estimated_arrival_at: estimatedArrivalAt,
      },
    });

    return { ride: firstRow(rows) };
  }),
  route("POST", /^\/api\/packages$/, async ({ token, user, body }) => {
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
    const rows = await restRequest(token, buildPath("/package_deliveries", { select: "*" }), {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        customer_id: user.id,
        pickup_lat: pickupLat,
        pickup_lng: pickupLng,
        pickup_address: pickupAddress,
        drop_lat: dropLat,
        drop_lng: dropLng,
        drop_address: dropAddress,
        fare_estimate: fareEstimate,
        package_size: body.package_size,
        receiver_name: receiverName,
        receiver_phone: receiverPhone,
        notes: body.notes || null,
        payment_method: body.payment_method || "cash",
        delivery_pin: deliveryPin,
        estimated_delivery_at: estimatedDeliveryAt,
      },
    });

    return { packageDelivery: firstRow(rows) };
  }),
  route("GET", /^\/api\/admin\/stats$/, async ({ token }) => {
    const [profiles, restaurants, foodOrders, rides, packages, stores] = await Promise.all([
      restRequest(token, buildPath("/profiles", { select: "id" })),
      restRequest(token, buildPath("/restaurants", { select: "id" })),
      restRequest(token, buildPath("/food_orders", { select: "id" })),
      restRequest(token, buildPath("/rides", { select: "id" })),
      restRequest(token, buildPath("/package_deliveries", { select: "id" })),
      restRequest(token, buildPath("/grocery_stores", { select: "id" })),
    ]);

    return {
      users: profiles?.length ?? 0,
      restaurants: restaurants?.length ?? 0,
      foodOrders: foodOrders?.length ?? 0,
      rides: rides?.length ?? 0,
      packages: packages?.length ?? 0,
      stores: stores?.length ?? 0,
    };
  }),
  route("GET", /^\/api\/admin\/analytics$/, async ({ token }) => {
    const [profiles, deliveryRoles, restaurants, stores, foodOrders, groceryOrders] =
      await Promise.all([
        restRequest(token, buildPath("/profiles", { select: "id,full_name,phone" })),
        restRequest(
          token,
          buildPath("/user_roles", { select: "user_id,role", role: "eq.delivery_boy" }),
        ),
        restRequest(
          token,
          buildPath("/restaurants", { select: "id,name,is_open", order: "name.asc" }),
        ),
        restRequest(
          token,
          buildPath("/grocery_stores", { select: "id,name,is_open", order: "name.asc" }),
        ),
        restRequest(
          token,
          buildPath("/food_orders", {
            select:
              "id,restaurant_id,total,status,created_at,delivery_boy_id,delivery_lat,delivery_lng,rider_lat,rider_lng",
          }),
        ),
        restRequest(
          token,
          buildPath("/grocery_orders", {
            select:
              "id,store_id,total,status,created_at,delivery_boy_id,delivery_lat,delivery_lng,rider_lat,rider_lng",
          }),
        ),
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
  route("GET", /^\/api\/admin\/restaurants$/, async ({ token }) => {
    const [restaurants, profiles, roles, orders] = await Promise.all([
      restRequest(token, buildPath("/restaurants", { select: "*", order: "created_at.desc" })),
      restRequest(token, buildPath("/profiles", { select: "id,full_name" })),
      restRequest(
        token,
        buildPath("/user_roles", { select: "user_id,role", role: "eq.hotel_manager" }),
      ),
      restRequest(token, buildPath("/food_orders", { select: "restaurant_id" })),
    ]);

    return {
      restaurants: restaurants ?? [],
      profiles: profiles ?? [],
      roles: roles ?? [],
      orders: orders ?? [],
    };
  }),
  route("POST", /^\/api\/admin\/restaurants$/, async ({ token, body }) => {
    const rows = await restRequest(token, buildPath("/restaurants", { select: "*" }), {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body,
    });

    return { restaurant: firstRow(rows) };
  }),
  route("PUT", /^\/api\/admin\/restaurants\/([^/]+)$/, async ({ token, match, body }) => {
    const id = decodeURIComponent(match[1]);
    const rows = await restRequest(
      token,
      buildPath("/restaurants", { id: `eq.${id}`, select: "*" }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body,
      },
    );

    return { restaurant: firstRow(rows) };
  }),
  route("DELETE", /^\/api\/admin\/restaurants\/([^/]+)$/, async ({ token, match }) => {
    const id = decodeURIComponent(match[1]);
    await restRequest(token, buildPath("/restaurants", { id: `eq.${id}` }), { method: "DELETE" });

    return { ok: true };
  }),
  route("POST", /^\/api\/admin\/restaurants\/([^/]+)\/toggle$/, async ({ token, match, body }) => {
    const id = decodeURIComponent(match[1]);
    const rows = await restRequest(
      token,
      buildPath("/restaurants", { id: `eq.${id}`, select: "*" }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { is_open: !!body.is_open },
      },
    );

    return { restaurant: firstRow(rows) };
  }),
  route(
    "POST",
    /^\/api\/admin\/restaurants\/([^/]+)\/grant-manager$/,
    async ({ token, match, body }) => {
      const id = decodeURIComponent(match[1]);
      if (!body.user_id) throw new HttpError(400, "user_id is required");

      await restRequest(token, "/user_roles", {
        method: "POST",
        body: { user_id: body.user_id, role: "hotel_manager" },
      });

      const rows = await restRequest(
        token,
        buildPath("/restaurants", { id: `eq.${id}`, select: "*" }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { manager_id: body.user_id },
        },
      );

      return { restaurant: firstRow(rows) };
    },
  ),
  route(
    "POST",
    /^\/api\/admin\/restaurants\/([^/]+)\/revoke-manager$/,
    async ({ token, match, body }) => {
      const id = decodeURIComponent(match[1]);
      if (!body.user_id) throw new HttpError(400, "user_id is required");

      await restRequest(
        token,
        buildPath("/user_roles", {
          user_id: `eq.${body.user_id}`,
          role: "eq.hotel_manager",
        }),
        { method: "DELETE" },
      );

      const rows = await restRequest(
        token,
        buildPath("/restaurants", { id: `eq.${id}`, select: "*" }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { manager_id: null, is_open: false },
        },
      );

      return { restaurant: firstRow(rows) };
    },
  ),
  route("GET", /^\/api\/admin\/stores$/, async ({ token }) => {
    const stores = await restRequest(
      token,
      buildPath("/grocery_stores", { select: "*", order: "created_at.desc" }),
    );

    return { stores: stores ?? [] };
  }),
  route("POST", /^\/api\/admin\/stores$/, async ({ token, body }) => {
    const rows = await restRequest(token, buildPath("/grocery_stores", { select: "*" }), {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body,
    });

    return { store: firstRow(rows) };
  }),
  route("PUT", /^\/api\/admin\/stores\/([^/]+)$/, async ({ token, match, body }) => {
    const id = decodeURIComponent(match[1]);
    const rows = await restRequest(
      token,
      buildPath("/grocery_stores", { id: `eq.${id}`, select: "*" }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body,
      },
    );

    return { store: firstRow(rows) };
  }),
  route("DELETE", /^\/api\/admin\/stores\/([^/]+)$/, async ({ token, match }) => {
    const id = decodeURIComponent(match[1]);
    await restRequest(token, buildPath("/grocery_stores", { id: `eq.${id}` }), {
      method: "DELETE",
    });

    return { ok: true };
  }),
  route("GET", /^\/api\/admin\/users$/, async ({ token, url }) => {
    const search = cleanText(url.searchParams.get("search"));
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") ?? 50)));
    const offset = (page - 1) * limit;

    const profileParams = {
      select: "id,full_name,phone",
      order: "full_name.asc",
      limit: String(limit),
      offset: String(offset),
    };
    if (search) {
      profileParams.or = `(full_name.ilike.*${search}*,phone.ilike.*${search}*)`;
    }

    const [profiles, roles, roleRequests, countRows] = await Promise.all([
      restRequest(token, buildPath("/profiles", profileParams)),
      restRequest(token, buildPath("/user_roles", { select: "user_id,role" })),
      restRequest(
        token,
        buildPath("/role_requests", {
          select: "*",
          status: "eq.pending",
          order: "created_at.desc",
        }),
      ),
      restRequest(
        token,
        buildPath("/profiles", { select: "id", ...(search ? { or: profileParams.or } : {}) }),
        {
          headers: { Prefer: "count=exact" },
        },
      ).catch(() => []),
    ]);

    return {
      profiles: profiles ?? [],
      roles: roles ?? [],
      roleRequests: roleRequests ?? [],
      page,
      limit,
      total: Array.isArray(countRows) ? countRows.length : (profiles?.length ?? 0),
    };
  }),
  route(
    "POST",
    /^\/api\/admin\/users\/([^/]+)\/roles\/toggle$/,
    async ({ token, user, match, body }) => {
      const userId = decodeURIComponent(match[1]);
      const role = body.role;
      const hasRole = !!body.has_role;

      if (!role) throw new HttpError(400, "role is required");

      if (hasRole) {
        await restRequest(
          token,
          buildPath("/user_roles", {
            user_id: `eq.${userId}`,
            role: `eq.${role}`,
          }),
          { method: "DELETE" },
        );
      } else {
        await restRequest(token, buildPath("/user_roles", { on_conflict: "user_id,role" }), {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates" },
          body: { user_id: userId, role },
        });
      }

      await writeAudit(
        token,
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
    async ({ token, user, match, body }) => {
      const requestId = decodeURIComponent(match[1]);
      const decision =
        body.decision === "approved"
          ? "approved"
          : body.decision === "rejected"
            ? "rejected"
            : null;
      if (!decision) throw new HttpError(400, "Decision must be approved or rejected");

      const requestRows = await restRequest(
        token,
        buildPath("/role_requests", { select: "*", id: `eq.${requestId}`, limit: "1" }),
      );
      const request = firstRow(requestRows);
      if (!request) throw new HttpError(404, "Role request not found");

      if (decision === "approved") {
        await restRequest(token, buildPath("/user_roles", { on_conflict: "user_id,role" }), {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates" },
          body: { user_id: request.user_id, role: request.requested_role },
        });
      }

      const rows = await restRequest(
        token,
        buildPath("/role_requests", { id: `eq.${requestId}`, select: "*" }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: {
            status: decision,
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString(),
          },
        },
      );

      await writeAudit(
        token,
        user.id,
        `role_request_${decision}`,
        "role_request",
        requestId,
        `${decision === "approved" ? "Approved" : "Rejected"} ${request.requested_role} request`,
        { user_id: request.user_id, requested_role: request.requested_role },
      );

      return { request: firstRow(rows) };
    },
  ),
  route("GET", /^\/api\/hotel\/dashboard$/, async ({ token, user }) => {
    const restaurantRows = await restRequest(
      token,
      buildPath("/restaurants", {
        select: "*",
        manager_id: `eq.${user.id}`,
      }),
    );

    const restaurant = firstRow(restaurantRows);
    if (!restaurant) {
      return { restaurant: null, stats: { total: 0, pending: 0, today: 0 } };
    }

    const orders = await restRequest(
      token,
      buildPath("/food_orders", {
        select: "id,status,created_at",
        restaurant_id: `eq.${restaurant.id}`,
      }),
    );

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
  route("PUT", /^\/api\/hotel\/restaurant$/, async ({ token, user, body }) => {
    const payload = {
      name: body.name,
      description: body.description ?? null,
      address: body.address ?? null,
      image_url: body.image_url ?? null,
      is_open: body.is_open ?? true,
      manager_id: user.id,
    };

    const rows = body.id
      ? await restRequest(token, buildPath("/restaurants", { id: `eq.${body.id}`, select: "*" }), {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: payload,
        })
      : await restRequest(token, buildPath("/restaurants", { select: "*" }), {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: payload,
        });

    return { restaurant: firstRow(rows) };
  }),
  route("GET", /^\/api\/hotel\/menu$/, async ({ token, user }) => {
    const restaurantRows = await restRequest(
      token,
      buildPath("/restaurants", {
        select: "id",
        manager_id: `eq.${user.id}`,
      }),
    );

    const restaurant = firstRow(restaurantRows);
    if (!restaurant) {
      return { restaurantId: null, items: [] };
    }

    const items = await restRequest(
      token,
      buildPath("/menu_items", {
        select: "*",
        restaurant_id: `eq.${restaurant.id}`,
        order: "created_at.desc",
      }),
    );

    return { restaurantId: restaurant.id, items: items ?? [] };
  }),
  route("POST", /^\/api\/hotel\/menu$/, async ({ token, user, body }) => {
    const restaurantRows = await restRequest(
      token,
      buildPath("/restaurants", { select: "id", manager_id: `eq.${user.id}` }),
    );

    const restaurant = firstRow(restaurantRows);
    if (!restaurant) throw new HttpError(400, "No restaurant assigned");

    const rows = await restRequest(token, buildPath("/menu_items", { select: "*" }), {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
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
      },
    });

    return { item: firstRow(rows) };
  }),
  route("PUT", /^\/api\/hotel\/menu\/([^/]+)$/, async ({ token, match, body }) => {
    const id = decodeURIComponent(match[1]);
    const rows = await restRequest(
      token,
      buildPath("/menu_items", { id: `eq.${id}`, select: "*" }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body,
      },
    );

    return { item: firstRow(rows) };
  }),
  route("DELETE", /^\/api\/hotel\/menu\/([^/]+)$/, async ({ token, match }) => {
    const id = decodeURIComponent(match[1]);
    await restRequest(token, buildPath("/menu_items", { id: `eq.${id}` }), { method: "DELETE" });

    return { ok: true };
  }),
  route("POST", /^\/api\/hotel\/menu\/([^/]+)\/toggle$/, async ({ token, match, body }) => {
    const id = decodeURIComponent(match[1]);
    const rows = await restRequest(
      token,
      buildPath("/menu_items", { id: `eq.${id}`, select: "*" }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { is_available: !!body.is_available },
      },
    );

    return { item: firstRow(rows) };
  }),
  route("GET", /^\/api\/hotel\/orders$/, async ({ token, user }) => {
    const restaurantRows = await restRequest(
      token,
      buildPath("/restaurants", { select: "id", manager_id: `eq.${user.id}` }),
    );

    const restaurant = firstRow(restaurantRows);
    if (!restaurant) {
      return { restaurantId: null, orders: [] };
    }

    const orders = await restRequest(
      token,
      buildPath("/food_orders", {
        select:
          "id,status,total,delivery_address,notes,created_at,food_order_items(id,name,quantity,price)",
        restaurant_id: `eq.${restaurant.id}`,
        order: "created_at.desc",
      }),
    );

    return { restaurantId: restaurant.id, orders: orders ?? [] };
  }),
  route("POST", /^\/api\/hotel\/orders\/([^/]+)\/advance$/, async ({ token, match, body }) => {
    const id = decodeURIComponent(match[1]);
    const rows = await restRequest(
      token,
      buildPath("/food_orders", { id: `eq.${id}`, select: "*" }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { status: body.status },
      },
    );

    return { order: firstRow(rows) };
  }),
  route("POST", /^\/api\/hotel\/orders\/([^/]+)\/reject$/, async ({ token, match, body }) => {
    const id = decodeURIComponent(match[1]);
    const rows = await restRequest(
      token,
      buildPath("/food_orders", { id: `eq.${id}`, select: "*" }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: {
          status: "cancelled",
          cancellation_reason: cleanText(body.reason) || "Rejected by restaurant",
          cancelled_at: new Date().toISOString(),
        },
      },
    );

    return { order: firstRow(rows) };
  }),
  route("GET", /^\/api\/hotel\/history$/, async ({ token, user }) => {
    const restaurantRows = await restRequest(
      token,
      buildPath("/restaurants", { select: "id", manager_id: `eq.${user.id}` }),
    );

    const restaurant = firstRow(restaurantRows);
    if (!restaurant) {
      return { restaurantId: null, orders: [] };
    }

    const orders = await restRequest(
      token,
      buildPath("/food_orders", {
        select:
          "id,status,total,delivery_address,notes,created_at,food_order_items(id,name,quantity,price)",
        restaurant_id: `eq.${restaurant.id}`,
        order: "created_at.desc",
        limit: "100",
      }),
    );

    return { restaurantId: restaurant.id, orders: orders ?? [] };
  }),
  route("GET", /^\/api\/grocery\/dashboard$/, async ({ token, user }) => {
    const storeRows = await restRequest(
      token,
      buildPath("/grocery_stores", {
        select: "*",
        manager_id: `eq.${user.id}`,
      }),
    );

    const store = firstRow(storeRows);
    if (!store) {
      return { store: null, stats: { total: 0, pending: 0, today: 0 } };
    }

    const orders = await restRequest(
      token,
      buildPath("/grocery_orders", {
        select: "id,status,created_at",
        store_id: `eq.${store.id}`,
      }),
    );

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
  route("PUT", /^\/api\/grocery\/store$/, async ({ token, user, body }) => {
    const payload = {
      name: body.name,
      description: body.description ?? null,
      address: body.address ?? null,
      image_url: body.image_url ?? null,
      is_open: body.is_open ?? true,
      manager_id: user.id,
    };

    const rows = body.id
      ? await restRequest(
          token,
          buildPath("/grocery_stores", { id: `eq.${body.id}`, select: "*" }),
          {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: payload,
          },
        )
      : await restRequest(token, buildPath("/grocery_stores", { select: "*" }), {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: payload,
        });

    return { store: firstRow(rows) };
  }),
  route("GET", /^\/api\/grocery\/items$/, async ({ token, user }) => {
    const storeRows = await restRequest(
      token,
      buildPath("/grocery_stores", { select: "id", manager_id: `eq.${user.id}` }),
    );

    const store = firstRow(storeRows);
    if (!store) {
      return { storeId: null, items: [] };
    }

    const items = await restRequest(
      token,
      buildPath("/grocery_items", {
        select: "*",
        store_id: `eq.${store.id}`,
        order: "created_at.desc",
      }),
    );

    return { storeId: store.id, items: items ?? [] };
  }),
  route("POST", /^\/api\/grocery\/items$/, async ({ token, user, body }) => {
    const storeRows = await restRequest(
      token,
      buildPath("/grocery_stores", { select: "id", manager_id: `eq.${user.id}` }),
    );

    const store = firstRow(storeRows);
    if (!store) throw new HttpError(400, "No store assigned");

    const rows = await restRequest(token, buildPath("/grocery_items", { select: "*" }), {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        store_id: store.id,
        name: body.name,
        description: body.description ?? null,
        price: body.price,
        category: body.category ?? null,
        image_url: body.image_url ?? null,
        is_available: body.is_available ?? true,
        stock_quantity: body.stock_quantity ?? 0,
        low_stock_threshold: body.low_stock_threshold ?? 5,
        expiry_date: body.expiry_date ?? null,
        aisle_location: body.aisle_location ?? null,
        unit: body.unit ?? "pcs",
      },
    });

    return { item: firstRow(rows) };
  }),
  route("PUT", /^\/api\/grocery\/items\/([^/]+)$/, async ({ token, match, body }) => {
    const id = decodeURIComponent(match[1]);
    const rows = await restRequest(
      token,
      buildPath("/grocery_items", { id: `eq.${id}`, select: "*" }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body,
      },
    );

    return { item: firstRow(rows) };
  }),
  route("DELETE", /^\/api\/grocery\/items\/([^/]+)$/, async ({ token, match }) => {
    const id = decodeURIComponent(match[1]);
    await restRequest(token, buildPath("/grocery_items", { id: `eq.${id}` }), { method: "DELETE" });

    return { ok: true };
  }),
  route("POST", /^\/api\/grocery\/items\/([^/]+)\/toggle$/, async ({ token, match, body }) => {
    const id = decodeURIComponent(match[1]);
    const rows = await restRequest(
      token,
      buildPath("/grocery_items", { id: `eq.${id}`, select: "*" }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { is_available: !!body.is_available },
      },
    );

    return { item: firstRow(rows) };
  }),
  route("GET", /^\/api\/grocery\/orders$/, async ({ token, user }) => {
    const storeRows = await restRequest(
      token,
      buildPath("/grocery_stores", { select: "id", manager_id: `eq.${user.id}` }),
    );

    const store = firstRow(storeRows);
    if (!store) {
      return { storeId: null, orders: [] };
    }

    const orders = await restRequest(
      token,
      buildPath("/grocery_orders", {
        select:
          "id,status,total,delivery_address,notes,created_at,grocery_order_items(id,name,quantity,price)",
        store_id: `eq.${store.id}`,
        order: "created_at.desc",
      }),
    );

    return { storeId: store.id, orders: orders ?? [] };
  }),
  route("POST", /^\/api\/grocery\/orders\/([^/]+)\/advance$/, async ({ token, match, body }) => {
    const id = decodeURIComponent(match[1]);
    const rows = await restRequest(
      token,
      buildPath("/grocery_orders", { id: `eq.${id}`, select: "*" }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { status: body.status },
      },
    );

    return { order: firstRow(rows) };
  }),
  route("GET", /^\/api\/grocery\/history$/, async ({ token, user }) => {
    const storeRows = await restRequest(
      token,
      buildPath("/grocery_stores", { select: "id", manager_id: `eq.${user.id}` }),
    );

    const store = firstRow(storeRows);
    if (!store) {
      return { storeId: null, orders: [] };
    }

    const orders = await restRequest(
      token,
      buildPath("/grocery_orders", {
        select:
          "id,status,total,delivery_address,notes,created_at,grocery_order_items(id,name,quantity,price)",
        store_id: `eq.${store.id}`,
        order: "created_at.desc",
        limit: "100",
      }),
    );

    return { storeId: store.id, orders: orders ?? [] };
  }),
  route("GET", /^\/api\/delivery\/available$/, async ({ token }) => {
    const [food, grocery] = await Promise.all([
      restRequest(
        token,
        buildPath("/food_orders", {
          select: "id,status,total,delivery_address,created_at,restaurants(name)",
          delivery_boy_id: "is.null",
          status: "in.(ready,preparing)",
          order: "created_at.desc",
        }),
      ),
      restRequest(
        token,
        buildPath("/grocery_orders", {
          select: "id,status,total,delivery_address,created_at,grocery_stores(name)",
          delivery_boy_id: "is.null",
          status: "in.(ready,preparing)",
          order: "created_at.desc",
        }),
      ),
    ]);

    return { food: food ?? [], grocery: grocery ?? [] };
  }),
  route("GET", /^\/api\/delivery\/active$/, async ({ token, user }) => {
    const [food, grocery] = await Promise.all([
      restRequest(
        token,
        buildPath("/food_orders", {
          select:
            "id,status,total,delivery_address,delivery_lat,delivery_lng,rider_lat,rider_lng,delivery_pin,customer_id,restaurants(name)",
          delivery_boy_id: `eq.${user.id}`,
          order: "created_at.desc",
        }),
      ),
      restRequest(
        token,
        buildPath("/grocery_orders", {
          select:
            "id,status,total,delivery_address,delivery_lat,delivery_lng,rider_lat,rider_lng,delivery_pin,customer_id,grocery_stores(name)",
          delivery_boy_id: `eq.${user.id}`,
          order: "created_at.desc",
        }),
      ),
    ]);

    const customerIds = [
      ...new Set(
        [...(food ?? []), ...(grocery ?? [])].map((order) => order.customer_id).filter(Boolean),
      ),
    ];
    let profileById = new Map();
    if (customerIds.length > 0) {
      const profiles = await restRequest(
        token,
        buildPath("/profiles", {
          select: "id,full_name,phone",
          id: `in.(${customerIds.join(",")})`,
        }),
      );
      profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    }

    const attachCustomer = (order) => ({
      ...normalizeDeliveryOrder(order),
      customer: profileById.get(order.customer_id) ?? null,
    });

    return {
      food: (food ?? []).map(attachCustomer),
      grocery: (grocery ?? []).map(attachCustomer),
    };
  }),
  route(
    "POST",
    /^\/api\/delivery\/(food|grocery)\/([^/]+)\/accept$/,
    async ({ token, user, match }) => {
      const kind = match[1];
      const id = decodeURIComponent(match[2]);
      const table = kind === "food" ? "food_orders" : "grocery_orders";
      const rows = await restRequest(
        token,
        buildPath(`/${table}`, { id: `eq.${id}`, select: "*" }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { delivery_boy_id: user.id },
        },
      );

      const order = firstRow(rows);
      if (!order) {
        throw new HttpError(404, "Delivery not found or already assigned");
      }

      return { order: normalizeDeliveryOrder(order) };
    },
  ),
  route(
    "POST",
    /^\/api\/delivery\/(food|grocery)\/([^/]+)\/advance$/,
    async ({ token, match, body }) => {
      const kind = match[1];
      const id = decodeURIComponent(match[2]);
      const table = kind === "food" ? "food_orders" : "grocery_orders";

      const currentRows = await restRequest(
        token,
        buildPath(`/${table}`, { id: `eq.${id}`, select: "*", limit: "1" }),
      );
      const current = firstRow(currentRows);
      if (!current) throw new HttpError(404, "Delivery not found or you are not assigned to it");

      verifyStatusAdvance("delivery", current.status, body.status);

      if (body.status === "delivered") {
        verifyDeliveryPin(current, body.delivery_pin);
      }

      const payload = { status: body.status };
      if (body.status === "delivered") {
        payload.payment_status = "paid";
      }

      const rows = await restRequest(
        token,
        buildPath(`/${table}`, { id: `eq.${id}`, select: "*" }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: payload,
        },
      );

      const order = firstRow(rows);
      if (!order) {
        throw new HttpError(404, "Delivery not found or you are not assigned to it");
      }

      return { order: normalizeDeliveryOrder(order) };
    },
  ),
  route("GET", /^\/api\/delivery\/history$/, async ({ token, user }) => {
    const [food, grocery] = await Promise.all([
      restRequest(
        token,
        buildPath("/food_orders", {
          select: "id,status,total,delivery_address,created_at,restaurants(name)",
          delivery_boy_id: `eq.${user.id}`,
          order: "created_at.desc",
          limit: "100",
        }),
      ),
      restRequest(
        token,
        buildPath("/grocery_orders", {
          select: "id,status,total,delivery_address,created_at,grocery_stores(name)",
          delivery_boy_id: `eq.${user.id}`,
          order: "created_at.desc",
          limit: "100",
        }),
      ),
    ]);

    return { food: food ?? [], grocery: grocery ?? [] };
  }),
  route("GET", /^\/api\/rider\/jobs$/, async ({ token, user }) => {
    const [rides, packages] = await Promise.all([
      restRequest(
        token,
        buildPath("/rides", {
          select:
            "id,pickup_address,pickup_lat,pickup_lng,drop_address,fare_estimate,status,created_at,rider_id,vehicle_type",
          or: `(rider_id.is.null,rider_id.eq.${user.id})`,
          status: "not.in.(completed,cancelled)",
          order: "created_at.desc",
        }),
      ),
      restRequest(
        token,
        buildPath("/package_deliveries", {
          select:
            "id,pickup_address,pickup_lat,pickup_lng,drop_address,fare_estimate,status,created_at,rider_id,package_size,receiver_name",
          or: `(rider_id.is.null,rider_id.eq.${user.id})`,
          status: "not.in.(completed,cancelled)",
          order: "created_at.desc",
        }),
      ),
    ]);

    return { rides: rides ?? [], packages: packages ?? [] };
  }),
  route("GET", /^\/api\/rider\/active$/, async ({ token, user, url }) => {
    const id = url.searchParams.get("id");
    const kind = url.searchParams.get("kind");
    const tables =
      kind === "package"
        ? ["package_deliveries"]
        : kind === "ride"
          ? ["rides"]
          : ["rides", "package_deliveries"];

    for (const table of tables) {
      const rows = await restRequest(
        token,
        buildPath(
          `/${table}`,
          id
            ? { select: "*", id: `eq.${id}`, order: "created_at.desc", limit: "1" }
            : {
                select: "*",
                rider_id: `eq.${user.id}`,
                status: "not.in.(completed,cancelled)",
                order: "created_at.desc",
                limit: "1",
              },
        ),
      );

      const job = firstRow(rows);
      if (job) {
        return { job, table };
      }
    }

    return { job: null, table: "rides" };
  }),
  route("POST", /^\/api\/rider\/rides\/([^/]+)\/accept$/, async ({ token, user, match }) => {
    const id = decodeURIComponent(match[1]);
    const rows = await restRequest(
      token,
      buildPath("/rides", {
        id: `eq.${id}`,
        rider_id: "is.null",
        select: "*",
      }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { rider_id: user.id, status: "accepted" },
      },
    );

    return { ride: firstRow(rows) };
  }),
  route("POST", /^\/api\/rider\/packages\/([^/]+)\/accept$/, async ({ token, user, match }) => {
    const id = decodeURIComponent(match[1]);
    const rows = await restRequest(
      token,
      buildPath("/package_deliveries", {
        id: `eq.${id}`,
        rider_id: "is.null",
        select: "*",
      }),
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { rider_id: user.id, status: "accepted" },
      },
    );

    return { packageDelivery: firstRow(rows) };
  }),
  route(
    "POST",
    /^\/api\/rider\/(rides|package_deliveries)\/([^/]+)\/advance$/,
    async ({ token, match, body }) => {
      const table = match[1];
      const id = decodeURIComponent(match[2]);

      const currentRows = await restRequest(
        token,
        buildPath(`/${table}`, { id: `eq.${id}`, select: "*", limit: "1" }),
      );
      const current = firstRow(currentRows);
      if (!current) throw new HttpError(404, "Job not found");

      verifyStatusAdvance(table === "rides" ? "ride" : "package", current.status, body.status);

      if (body.status === "completed") {
        verifyDeliveryPin(current, body.delivery_pin);
      }

      const rows = await restRequest(
        token,
        buildPath(`/${table}`, { id: `eq.${id}`, select: "*" }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { status: body.status },
        },
      );

      return { job: firstRow(rows) };
    },
  ),
  route(
    "POST",
    /^\/api\/rider\/(rides|package_deliveries)\/([^/]+)\/cancel$/,
    async ({ token, match }) => {
      const table = match[1];
      const id = decodeURIComponent(match[2]);
      const rows = await restRequest(
        token,
        buildPath(`/${table}`, { id: `eq.${id}`, select: "*" }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { status: "cancelled", rider_id: null },
        },
      );

      return { job: firstRow(rows) };
    },
  ),
  route("GET", /^\/api\/rider\/history$/, async ({ token, user }) => {
    const [rides, packages] = await Promise.all([
      restRequest(
        token,
        buildPath("/rides", {
          select:
            "id,pickup_address,pickup_lat,pickup_lng,drop_address,fare_estimate,status,created_at,rider_id,vehicle_type",
          rider_id: `eq.${user.id}`,
          order: "created_at.desc",
          limit: "100",
        }),
      ),
      restRequest(
        token,
        buildPath("/package_deliveries", {
          select:
            "id,pickup_address,pickup_lat,pickup_lng,drop_address,fare_estimate,status,created_at,rider_id,package_size,receiver_name",
          rider_id: `eq.${user.id}`,
          order: "created_at.desc",
          limit: "100",
        }),
      ),
    ]);

    return { rides: rides ?? [], packages: packages ?? [] };
  }),
  route("GET", /^\/api\/admin\/commissions$/, async ({ token }) => ({
    commissions: await getPlatformCommissions(token),
  })),
  route("PUT", /^\/api\/admin\/commissions$/, async ({ token, body }) => {
    const value = {
      restaurant: Number(body.restaurant ?? DEFAULT_COMMISSIONS.restaurant),
      grocery: Number(body.grocery ?? DEFAULT_COMMISSIONS.grocery),
      delivery: Number(body.delivery ?? DEFAULT_COMMISSIONS.delivery),
    };
    const saved = await savePlatformCommissions(token, value);
    return { commissions: saved };
  }),
  route("POST", /^\/api\/reviews$/, async ({ token, user, body }) => {
    const allowed = ["food", "grocery", "ride", "package"];
    const serviceKind = body.service_kind;
    if (!allowed.includes(serviceKind)) {
      throw new HttpError(400, "Invalid service kind for review");
    }
    const serviceId = requireText(body.service_id, "Service id", 80);
    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new HttpError(400, "Rating must be between 1 and 5");
    }

    const rows = await restRequest(token, buildPath("/order_reviews", { select: "*" }), {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        user_id: user.id,
        service_kind: serviceKind,
        service_id: serviceId,
        rating,
        comment: sanitizeComment(body.comment),
      },
    });

    return { review: firstRow(rows) };
  }),
  route("GET", /^\/api\/reviews\/([^/]+)\/([^/]+)$/, async ({ token, match }) => {
    const serviceKind = match[1];
    const serviceId = decodeURIComponent(match[2]);
    const rows = await restRequest(
      token,
      buildPath("/order_reviews", {
        select: "id,rating,comment,created_at,user_id",
        service_kind: `eq.${serviceKind}`,
        service_id: `eq.${serviceId}`,
        order: "created_at.desc",
        limit: "20",
      }),
    );
    return { reviews: rows ?? [] };
  }),
  route("GET", /^\/api\/delivery\/earnings$/, async ({ token, user }) => {
    const [food, grocery] = await Promise.all([
      restRequest(
        token,
        buildPath("/food_orders", {
          select: "id,total,status,created_at",
          delivery_boy_id: `eq.${user.id}`,
          status: "eq.delivered",
        }),
      ),
      restRequest(
        token,
        buildPath("/grocery_orders", {
          select: "id,total,status,created_at",
          delivery_boy_id: `eq.${user.id}`,
          status: "eq.delivered",
        }),
      ),
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
  route("GET", /^\/api\/rider\/earnings$/, async ({ token, user }) => {
    const [rides, packages] = await Promise.all([
      restRequest(
        token,
        buildPath("/rides", {
          select: "id,fare_estimate,status,created_at",
          rider_id: `eq.${user.id}`,
          status: "eq.completed",
        }),
      ),
      restRequest(
        token,
        buildPath("/package_deliveries", {
          select: "id,fare_estimate,status,created_at",
          rider_id: `eq.${user.id}`,
          status: "eq.completed",
        }),
      ),
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
  route("GET", /^\/api\/grocery\/alerts$/, async ({ token, user }) => {
    const storeRows = await restRequest(
      token,
      buildPath("/grocery_stores", { select: "id", manager_id: `eq.${user.id}` }),
    );
    const store = firstRow(storeRows);
    if (!store) return { lowStock: [], expiringSoon: [] };

    const items = await restRequest(
      token,
      buildPath("/grocery_items", {
        select: "id,name,stock_quantity,low_stock_threshold,expiry_date,is_available",
        store_id: `eq.${store.id}`,
      }),
    );

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
