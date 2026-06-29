import { restRequest, serviceRoleRestRequest } from "../lib/supabase.mjs";
import { HttpError, isMissingTableError } from "../lib/http.mjs";
import { cleanText } from "../lib/request-utils.mjs";
import {
  generateDeliveryPin,
  estimateDeliveryAt,
} from "../lib/platform-helpers.mjs";

function firstRow(rows) {
  return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
}

function buildPath(pathname, params = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    query.set(key, value);
  }

  const qs = query.toString();
  return qs ? `${pathname}?${qs}` : pathname;
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

async function getProfileMap(token, ids) {
  const uniqueIds = [...new Set((ids ?? []).filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const path = buildPath("/profiles", {
    select: "id,full_name,phone",
    id: `in.(${uniqueIds.join(",")})`,
  });

  try {
    const rows = await serviceRoleRestRequest(path).catch(() => restRequest(token, path));
    return new Map((rows ?? []).map((profile) => [profile.id, profile]));
  } catch (error) {
    console.warn(`Profile lookup unavailable: ${error.message}`);
    return new Map();
  }
}

async function attachUserProfiles(token, rows, mappings) {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const ids = list.flatMap((row) => Object.values(mappings).map((column) => row?.[column]));
  const profileMap = await getProfileMap(token, ids);

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

export const partnerRoutes = [
  {
    method: "GET",
    pattern: /^\/api\/delivery\/available$/,
    handler: async ({ token }) => {
      const [food, grocery] = await Promise.all([
        restRequest(
          token,
          buildPath("/food_orders", {
            select: "id,status,total,delivery_address,delivery_lat,delivery_lng,pickup_address,pickup_lat,pickup_lng,created_at,customer_id,restaurants(name)",
            delivery_boy_id: "is.null",
            status: "in.(ready,preparing)",
            order: "created_at.desc",
          }),
        ),
        restRequest(
          token,
          buildPath("/grocery_orders", {
            select: "id,status,total,delivery_address,delivery_lat,delivery_lng,pickup_address,pickup_lat,pickup_lng,created_at,customer_id,grocery_stores(name)",
            delivery_boy_id: "is.null",
            status: "in.(ready,preparing)",
            order: "created_at.desc",
          }),
        ),
      ]);

      return {
        food: await attachUserProfiles(token, food ?? [], { customer: "customer_id" }),
        grocery: await attachUserProfiles(token, grocery ?? [], { customer: "customer_id" }),
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/delivery\/active$/,
    handler: async ({ token, user }) => {
      const [food, grocery] = await Promise.all([
        restRequest(
          token,
          buildPath("/food_orders", {
            select:
              "id,status,total,delivery_address,delivery_lat,delivery_lng,pickup_address,pickup_lat,pickup_lng,rider_lat,rider_lng,delivery_pin,customer_id,restaurants(name)",
            delivery_boy_id: `eq.${user.id}`,
            order: "created_at.desc",
          }),
        ),
        restRequest(
          token,
          buildPath("/grocery_orders", {
            select:
              "id,status,total,delivery_address,delivery_lat,delivery_lng,pickup_address,pickup_lat,pickup_lng,rider_lat,rider_lng,delivery_pin,customer_id,grocery_stores(name)",
            delivery_boy_id: `eq.${user.id}`,
            order: "created_at.desc",
          }),
        ),
      ]);

      const hydratedFood = await attachUserProfiles(token, food ?? [], { customer: "customer_id" });
      const hydratedGrocery = await attachUserProfiles(token, grocery ?? [], { customer: "customer_id" });

      const normalize = (order) => ({
        ...order,
        rider_id: order.rider_id ?? order.delivery_boy_id ?? null,
        profiles: order.customer || null,
      });

      return {
        food: hydratedFood.map(normalize),
        grocery: hydratedGrocery.map(normalize),
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/delivery\/(food|grocery)\/([^/]+)\/accept$/,
    handler: async ({ token, user, match }) => {
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

      return { order: { ...order, rider_id: order.rider_id ?? order.delivery_boy_id ?? null } };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/delivery\/(food|grocery)\/([^/]+)\/advance$/,
    handler: async ({ token, user, match, body }) => {
      const kind = match[1];
      const id = decodeURIComponent(match[2]);
      const table = kind === "food" ? "food_orders" : "grocery_orders";

      const currentRows = await restRequest(
        token,
        buildPath(`/${table}`, { id: `eq.${id}`, delivery_boy_id: `eq.${user.id}`, select: "*", limit: "1" }),
      );
      const current = firstRow(currentRows);
      if (!current) throw new HttpError(404, "Delivery not found or you are not assigned to it");

      const { assertStatusAdvance } = await import("../lib/platform-helpers.mjs");
      assertStatusAdvance("delivery", current.status, body.status);

      if (body.status === "delivered") {
        const expected = current?.delivery_pin;
        if (expected) {
           const pin = cleanText(body.delivery_pin);
           if (pin !== expected) {
             throw new HttpError(400, "Invalid delivery PIN");
           }
        }
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

      return { order: { ...order, rider_id: order.rider_id ?? order.delivery_boy_id ?? null } };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/delivery\/history$/,
    handler: async ({ token, user }) => {
      const [food, grocery] = await Promise.all([
        restRequest(
          token,
          buildPath("/food_orders", {
            select: "id,status,total,delivery_address,created_at,restaurants(name)",
            delivery_boy_id: `eq.${user.id}`,
            status: "in.(delivered,completed,cancelled)",
            order: "created_at.desc",
            limit: "100",
          }),
        ),
        restRequest(
          token,
          buildPath("/grocery_orders", {
            select: "id,status,total,delivery_address,created_at,grocery_stores(name)",
            delivery_boy_id: `eq.${user.id}`,
            status: "in.(delivered,completed,cancelled)",
            order: "created_at.desc",
            limit: "100",
          }),
        ),
      ]);

      return { food: food ?? [], grocery: grocery ?? [] };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/rider\/jobs$/,
    handler: async ({ token, user }) => {
      const [rides, packages] = await Promise.all([
        restRequest(
          token,
          buildPath("/rides", {
            select:
              "id,pickup_address,pickup_lat,pickup_lng,drop_address,drop_lat,drop_lng,fare_estimate,status,created_at,customer_id,rider_id,vehicle_type",
            or: `(rider_id.is.null,rider_id.eq.${user.id})`,
            status: "not.in.(completed,cancelled)",
            order: "created_at.desc",
          }),
        ),
        restRequest(
          token,
          buildPath("/package_deliveries", {
            select:
              "id,pickup_address,pickup_lat,pickup_lng,drop_address,drop_lat,drop_lng,fare_estimate,status,created_at,customer_id,rider_id,package_size,receiver_name",
            or: `(rider_id.is.null,rider_id.eq.${user.id})`,
            status: "not.in.(completed,cancelled)",
            order: "created_at.desc",
          }),
        ),
      ]);

      return {
        rides: await attachUserProfiles(token, rides ?? [], { customer: "customer_id" }),
        packages: await attachUserProfiles(token, packages ?? [], { customer: "customer_id" }),
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/rider\/active$/,
    handler: async ({ token, user, url }) => {
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
          return {
            job: await attachUserProfiles(token, job, { customer: "customer_id" }),
            table,
          };
        }
      }

      return { job: null, table: "rides" };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/rider\/rides\/([^/]+)\/accept$/,
    handler: async ({ token, user, match }) => {
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
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/rider\/packages\/([^/]+)\/accept$/,
    handler: async ({ token, user, match }) => {
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
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/rider\/(rides|package_deliveries)\/([^/]+)\/advance$/,
    handler: async ({ token, user, match, body }) => {
      const table = match[1];
      const id = decodeURIComponent(match[2]);

      const currentRows = await restRequest(
        token,
        buildPath(`/${table}`, { id: `eq.${id}`, rider_id: `eq.${user.id}`, select: "*", limit: "1" }),
      );
      const current = firstRow(currentRows);
      if (!current) throw new HttpError(404, "Job not found");

      const { assertStatusAdvance } = await import("../lib/platform-helpers.mjs");
      assertStatusAdvance(table === "rides" ? "ride" : "package", current.status, body.status);

      if (body.status === "completed") {
        const expected = current?.delivery_pin;
        if (expected) {
           const pin = cleanText(body.delivery_pin);
           if (pin !== expected) {
             throw new HttpError(400, "Invalid delivery PIN");
           }
        }
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
  },
  {
    method: "POST",
    pattern: /^\/api\/rider\/(rides|package_deliveries)\/([^/]+)\/cancel$/,
    handler: async ({ token, user, match }) => {
      const table = match[1];
      const id = decodeURIComponent(match[2]);
      const rows = await restRequest(
        token,
        buildPath(`/${table}`, { id: `eq.${id}`, rider_id: `eq.${user.id}`, select: "*" }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { status: "cancelled", rider_id: null },
        },
      );

      return { job: firstRow(rows) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/rider\/history$/,
    handler: async ({ token, user }) => {
      const [rides, packages] = await Promise.all([
        restRequest(
          token,
          buildPath("/rides", {
            select:
              "id,pickup_address,pickup_lat,pickup_lng,drop_address,fare_estimate,status,created_at,customer_id,rider_id,vehicle_type",
            rider_id: `eq.${user.id}`,
            order: "created_at.desc",
            limit: "100",
          }),
        ),
        restRequest(
          token,
          buildPath("/package_deliveries", {
            select:
              "id,pickup_address,pickup_lat,pickup_lng,drop_address,fare_estimate,status,created_at,customer_id,rider_id,package_size,receiver_name",
            rider_id: `eq.${user.id}`,
            order: "created_at.desc",
            limit: "100",
          }),
        ),
      ]);

      return {
        rides: await attachUserProfiles(token, rides ?? [], { customer: "customer_id" }),
        packages: await attachUserProfiles(token, packages ?? [], { customer: "customer_id" }),
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/delivery\/earnings$/,
    handler: async ({ token, user }) => {
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
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/rider\/earnings$/,
    handler: async ({ token, user }) => {
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
    },
  },
];
