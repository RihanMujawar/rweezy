import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { ROOT_DIR, env } from "./lib/env.mjs";
import {
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
  getUserFromToken,
  refreshAuthSession,
  restRequest,
  revokeSession,
  signInWithPassword,
  signUpWithPassword,
} from "./lib/supabase.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDistDir = path.join(ROOT_DIR, "frontend", "dist");
const frontendClientDir = path.join(frontendDistDir, "client");
const frontendServerEntryPath = path.join(frontendDistDir, "server", "index.js");
const ACCESS_COOKIE = "zoomly_access_token";
const REFRESH_COOKIE = "zoomly_refresh_token";

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
  return Array.isArray(rows) ? rows[0] ?? null : rows ?? null;
}

function normalizeDeliveryOrder(row) {
  if (!row) return row;

  return {
    ...row,
    rider_id: row.rider_id ?? row.delivery_boy_id ?? null,
  };
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeChatKind(kind) {
  return ["ride", "package", "food", "grocery"].includes(kind) ? kind : null;
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
  return ["customer", "hotel_manager", "delivery_boy"].includes(role) ? role : "customer";
}

function isPublicApiRoute(method, pathname) {
  return (
    pathname === "/api/health" ||
    (method === "POST" && pathname === "/api/auth/login") ||
    (method === "POST" && pathname === "/api/auth/register") ||
    (method === "POST" && pathname === "/api/auth/logout") ||
    (method === "GET" && pathname === "/api/map/route")
  );
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
    }),
    serializeCookie(REFRESH_COOKIE, session.refreshToken, {
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "Lax",
    }),
  ];
}

function clearSessionCookies() {
  return [
    serializeCookie(ACCESS_COOKIE, "", {
      maxAge: 0,
      path: "/",
      sameSite: "Lax",
    }),
    serializeCookie(REFRESH_COOKIE, "", {
      maxAge: 0,
      path: "/",
      sameSite: "Lax",
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
    serverEntryPromise = import(frontendServerEntryPath).then(async (mod) => mod.createServerEntry(mod.default));
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
  route("GET", /^\/api\/health$/, async () => ({ ok: true })),
  route("POST", /^\/api\/auth\/login$/, async ({ body }) => {
    const email = cleanText(body.email);
    const phone = cleanText(body.phone);
    let identifier = { email };

    if (phone) {
      const rows = await restRequest(
        null,
        "/rpc/email_for_phone_login",
        {
          method: "POST",
          body: { lookup_phone: phone },
        },
      );
      const foundEmail = typeof rows === "string" ? rows : null;
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
    const phone = cleanText(body.phone);
    const role = "customer";

    const result = await signUpWithPassword(body.email, body.password, body.full_name, {
      role,
      phone,
    });
    const normalized = normalizeAuthSession(result);
    const roles = normalized.accessToken && normalized.user
      ? await getRoles(normalized.accessToken, normalized.user.id)
      : [];

    return {
      user: normalized.user,
      roles,
      authenticated: Boolean(normalized.accessToken),
      __responseHeaders: {
        "Set-Cookie": buildSessionCookies(result),
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
    const orderRows = await restRequest(
      token,
      buildPath("/food_orders", { select: "*" }),
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          customer_id: user.id,
          restaurant_id: body.restaurant_id,
          delivery_address: body.delivery_address,
          delivery_lat: body.delivery_lat ?? null,
          delivery_lng: body.delivery_lng ?? null,
          notes: body.notes || null,
          total: body.total,
        },
      },
    );

    const order = firstRow(orderRows);
    if (!order) {
      throw new HttpError(500, "Failed to create food order");
    }

    const items = (body.items ?? []).map((item) => ({
      order_id: order.id,
      menu_item_id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    }));

    if (items.length > 0) {
      await restRequest(token, "/food_order_items", {
        method: "POST",
        body: items,
      });
    }

    return { order };
  }),
  route("POST", /^\/api\/orders\/grocery$/, async ({ token, user, body }) => {
    const orderRows = await restRequest(
      token,
      buildPath("/grocery_orders", { select: "*" }),
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          customer_id: user.id,
          store_id: body.store_id,
          delivery_address: body.delivery_address,
          delivery_lat: body.delivery_lat ?? null,
          delivery_lng: body.delivery_lng ?? null,
          notes: body.notes || null,
          total: body.total,
        },
      },
    );

    const order = firstRow(orderRows);
    if (!order) {
      throw new HttpError(500, "Failed to create grocery order");
    }

    const items = (body.items ?? []).map((item) => ({
      order_id: order.id,
      grocery_item_id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    }));

    if (items.length > 0) {
      await restRequest(token, "/grocery_order_items", {
        method: "POST",
        body: items,
      });
    }

    return { order };
  }),
  route("GET", /^\/api\/orders\/me$/, async ({ token, user }) => {
    const [food, grocery, rides, packages] = await Promise.all([
      restRequest(
        token,
        buildPath("/food_orders", {
          select: "id,status,total,delivery_address,created_at,rider_id:delivery_boy_id,restaurants(name)",
          customer_id: `eq.${user.id}`,
          order: "created_at.desc",
        }),
      ),
      restRequest(
        token,
        buildPath("/grocery_orders", {
          select: "id,status,total,delivery_address,created_at,rider_id:delivery_boy_id,grocery_stores(name)",
          customer_id: `eq.${user.id}`,
          order: "created_at.desc",
        }),
      ),
      restRequest(
        token,
        buildPath("/rides", {
          select: "id,status,fare_estimate,pickup_address,drop_address,created_at,rider_id,vehicle_type",
          customer_id: `eq.${user.id}`,
          order: "created_at.desc",
        }),
      ),
      restRequest(
        token,
        buildPath("/package_deliveries", {
          select: "id,status,fare_estimate,pickup_address,drop_address,created_at,rider_id,package_size",
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

    return {
      row: kind === "food" || kind === "grocery" ? normalizeDeliveryOrder(row) : row,
    };
  }),
  route("GET", /^\/api\/chat\/(ride|package|food|grocery)\/([^/]+)$/, async ({ token, user, match }) => {
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
  }),
  route("POST", /^\/api\/chat\/(ride|package|food|grocery)\/([^/]+)$/, async ({ token, user, match, body }) => {
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

    const rows = await restRequest(
      token,
      buildPath("/chat_messages", { select: "*" }),
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          service_kind: kind,
          service_id: serviceId,
          sender_id: user.id,
          body: messageBody,
        },
      },
    );

    return { message: firstRow(rows) };
  }),
  route("POST", /^\/api\/rides$/, async ({ token, user, body }) => {
    const rows = await restRequest(
      token,
      buildPath("/rides", { select: "*" }),
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          customer_id: user.id,
          pickup_lat: body.pickup_lat,
          pickup_lng: body.pickup_lng,
          pickup_address: body.pickup_address,
          drop_lat: body.drop_lat,
          drop_lng: body.drop_lng,
          drop_address: body.drop_address,
          fare_estimate: body.fare_estimate,
          vehicle_type: body.vehicle_type,
          notes: body.notes || null,
        },
      },
    );

    return { ride: firstRow(rows) };
  }),
  route("POST", /^\/api\/packages$/, async ({ token, user, body }) => {
    const rows = await restRequest(
      token,
      buildPath("/package_deliveries", { select: "*" }),
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          customer_id: user.id,
          pickup_lat: body.pickup_lat,
          pickup_lng: body.pickup_lng,
          pickup_address: body.pickup_address,
          drop_lat: body.drop_lat,
          drop_lng: body.drop_lng,
          drop_address: body.drop_address,
          fare_estimate: body.fare_estimate,
          package_size: body.package_size,
          receiver_name: body.receiver_name,
          receiver_phone: body.receiver_phone,
          notes: body.notes || null,
        },
      },
    );

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
  route("GET", /^\/api\/admin\/restaurants$/, async ({ token }) => {
    const [restaurants, profiles, roles, orders] = await Promise.all([
      restRequest(token, buildPath("/restaurants", { select: "*", order: "created_at.desc" })),
      restRequest(token, buildPath("/profiles", { select: "id,full_name" })),
      restRequest(token, buildPath("/user_roles", { select: "user_id,role", role: "eq.hotel_manager" })),
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
    const rows = await restRequest(
      token,
      buildPath("/restaurants", { select: "*" }),
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body,
      },
    );

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
    await restRequest(
      token,
      buildPath("/restaurants", { id: `eq.${id}` }),
      { method: "DELETE" },
    );

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
  route("POST", /^\/api\/admin\/restaurants\/([^/]+)\/grant-manager$/, async ({ token, match, body }) => {
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
  }),
  route("POST", /^\/api\/admin\/restaurants\/([^/]+)\/revoke-manager$/, async ({ token, match, body }) => {
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
  }),
  route("GET", /^\/api\/admin\/stores$/, async ({ token }) => {
    const stores = await restRequest(
      token,
      buildPath("/grocery_stores", { select: "*", order: "created_at.desc" }),
    );

    return { stores: stores ?? [] };
  }),
  route("POST", /^\/api\/admin\/stores$/, async ({ token, body }) => {
    const rows = await restRequest(
      token,
      buildPath("/grocery_stores", { select: "*" }),
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body,
      },
    );

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
    await restRequest(
      token,
      buildPath("/grocery_stores", { id: `eq.${id}` }),
      { method: "DELETE" },
    );

    return { ok: true };
  }),
  route("GET", /^\/api\/admin\/users$/, async ({ token }) => {
    const [profiles, roles] = await Promise.all([
      restRequest(token, buildPath("/profiles", { select: "id,full_name,phone", order: "full_name.asc" })),
      restRequest(token, buildPath("/user_roles", { select: "user_id,role" })),
    ]);

    return {
      profiles: profiles ?? [],
      roles: roles ?? [],
    };
  }),
  route("POST", /^\/api\/admin\/users\/([^/]+)\/roles\/toggle$/, async ({ token, match, body }) => {
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
      await restRequest(token, "/user_roles", {
        method: "POST",
        body: { user_id: userId, role },
      });
    }

    return { ok: true };
  }),
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
        pending: orders?.filter((order) => ["pending", "accepted", "preparing"].includes(order.status)).length ?? 0,
        today: orders?.filter((order) => new Date(order.created_at).toDateString() === today).length ?? 0,
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
      ? await restRequest(
          token,
          buildPath("/restaurants", { id: `eq.${body.id}`, select: "*" }),
          {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: payload,
          },
        )
      : await restRequest(
          token,
          buildPath("/restaurants", { select: "*" }),
          {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: payload,
          },
        );

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

    const rows = await restRequest(
      token,
      buildPath("/menu_items", { select: "*" }),
      {
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
        },
      },
    );

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
    await restRequest(
      token,
      buildPath("/menu_items", { id: `eq.${id}` }),
      { method: "DELETE" },
    );

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
        select: "id,status,total,delivery_address,notes,created_at,food_order_items(id,name,quantity,price)",
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
        pending: orders?.filter((order) => ["pending", "accepted", "preparing"].includes(order.status)).length ?? 0,
        today: orders?.filter((order) => new Date(order.created_at).toDateString() === today).length ?? 0,
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
      : await restRequest(
          token,
          buildPath("/grocery_stores", { select: "*" }),
          {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: payload,
          },
        );

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

    const rows = await restRequest(
      token,
      buildPath("/grocery_items", { select: "*" }),
      {
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
        },
      },
    );

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
    await restRequest(
      token,
      buildPath("/grocery_items", { id: `eq.${id}` }),
      { method: "DELETE" },
    );

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
        select: "id,status,total,delivery_address,notes,created_at,grocery_order_items(id,name,quantity,price)",
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
          select: "id,status,total,delivery_address,delivery_lat,delivery_lng,rider_lat,rider_lng,restaurants(name)",
          delivery_boy_id: `eq.${user.id}`,
          order: "created_at.desc",
        }),
      ),
      restRequest(
        token,
        buildPath("/grocery_orders", {
          select: "id,status,total,delivery_address,delivery_lat,delivery_lng,rider_lat,rider_lng,grocery_stores(name)",
          delivery_boy_id: `eq.${user.id}`,
          order: "created_at.desc",
        }),
      ),
    ]);

    return { food: food ?? [], grocery: grocery ?? [] };
  }),
  route("POST", /^\/api\/delivery\/(food|grocery)\/([^/]+)\/accept$/, async ({ token, user, match }) => {
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
  }),
  route("POST", /^\/api\/delivery\/(food|grocery)\/([^/]+)\/advance$/, async ({ token, match, body }) => {
    const kind = match[1];
    const id = decodeURIComponent(match[2]);
    const table = kind === "food" ? "food_orders" : "grocery_orders";
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
  }),
  route("GET", /^\/api\/rider\/jobs$/, async ({ token, user }) => {
    const [rides, packages] = await Promise.all([
      restRequest(
        token,
        buildPath("/rides", {
          select: "id,pickup_address,pickup_lat,pickup_lng,drop_address,fare_estimate,status,created_at,rider_id,vehicle_type",
          or: `(rider_id.is.null,rider_id.eq.${user.id})`,
          status: "not.in.(completed,cancelled)",
          order: "created_at.desc",
        }),
      ),
      restRequest(
        token,
        buildPath("/package_deliveries", {
          select: "id,pickup_address,pickup_lat,pickup_lng,drop_address,fare_estimate,status,created_at,rider_id,package_size,receiver_name",
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
    const tables = kind === "package"
      ? ["package_deliveries"]
      : kind === "ride"
        ? ["rides"]
        : ["rides", "package_deliveries"];

    for (const table of tables) {
      const rows = await restRequest(
        token,
        buildPath(`/${table}`, id
          ? { select: "*", id: `eq.${id}`, order: "created_at.desc", limit: "1" }
          : {
              select: "*",
              rider_id: `eq.${user.id}`,
              status: "not.in.(completed,cancelled)",
              order: "created_at.desc",
              limit: "1",
            }),
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
  route("POST", /^\/api\/rider\/(rides|package_deliveries)\/([^/]+)\/advance$/, async ({ token, match, body }) => {
    const table = match[1];
    const id = decodeURIComponent(match[2]);
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
  }),
  route("POST", /^\/api\/rider\/(rides|package_deliveries)\/([^/]+)\/cancel$/, async ({ token, match }) => {
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

async function handleApi(req, res, url) {
  const matched = await matchApiRoute(req, url);
  if (!matched) {
    throw new HttpError(404, "API route not found");
  }

  const corsHeaders = getCorsHeaders(req.headers.origin || "*");

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
      res.writeHead(204, getCorsHeaders(req.headers.origin || "*"));
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
    if (!(error instanceof HttpError)) {
      console.error(error);
    }

    const headers = url.pathname.startsWith("/api/")
      ? getCorsHeaders(req.headers.origin || "*")
      : {};

    sendJson(res, status, { error: message }, headers);
  }
});

server.listen(env.port, env.host, () => {
  console.log(`Backend listening on http://${env.host}:${env.port}`);
});
