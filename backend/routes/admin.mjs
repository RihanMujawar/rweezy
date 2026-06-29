import { restRequest, serviceRoleRestRequest, getRoles } from "../lib/supabase.mjs";
import { HttpError, isMissingTableError } from "../lib/http.mjs";
import { cleanText } from "../lib/request-utils.mjs";

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

function normalizeCatalogRadius(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_CATALOG_RADIUS_KM;
  return Math.max(MIN_CATALOG_RADIUS_KM, Math.min(MAX_CATALOG_RADIUS_KM, Math.round(num)));
}

async function saveCatalogRadiusKm(token, radiusKm) {
  const value = normalizeCatalogRadius(radiusKm);
  const rows = await restRequest(
    token,
    buildPath("/platform_settings", {
      select: "key,value",
      key: "eq.catalog_radius_km",
      limit: "1",
    }),
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: { key: "catalog_radius_km", value },
    },
  );
  return normalizeCatalogRadius(firstRow(rows)?.value);
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

async function getCatalogRadiusKm(token) {
  try {
    const rows = await restRequest(
      token,
      buildPath("/platform_settings", { select: "value", key: "eq.catalog_radius_km", limit: "1" }),
    );
    const row = firstRow(rows);
    return normalizeCatalogRadius(row?.value);
  } catch (error) {
    if (!isMissingTableError(error, "platform_settings")) {
      console.warn(`Catalog radius setting unavailable: ${error.message}`);
    }
  }
  return DEFAULT_CATALOG_RADIUS_KM;
}

async function assertAdmin(token, userId) {
  const roles = await getRoles(token, userId);
  if (!roles.includes("admin")) {
    throw new HttpError(403, "Admin access required");
  }
}

export const adminRoutes = [
  {
    method: "GET",
    pattern: /^\/api\/admin\/health$/,
    handler: async ({ token, user }) => {
      await assertAdmin(token, user.id);
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
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/stats$/,
    handler: async ({ token, user }) => {
      await assertAdmin(token, user.id);
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
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/analytics$/,
    handler: async ({ token, user }) => {
      await assertAdmin(token, user.id);
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
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/restaurants$/,
    handler: async ({ token, user, url }) => {
      await assertAdmin(token, user.id);
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") ?? 20)));
      const offset = (page - 1) * limit;
      const fetchLimit = limit + 1;
      const restaurants = await restRequest(
        token,
        buildPath("/restaurants", {
          select: "*",
          order: "created_at.desc",
          limit: String(fetchLimit),
          offset: String(offset),
        }),
      );
      const hasNext = (restaurants?.length ?? 0) > limit;
      const pageRestaurants = (restaurants ?? []).slice(0, limit);
      const managerIds = pageRestaurants
        .map((item) => item?.manager_id)
        .filter((id) => typeof id === "string" && id.length > 0);
      const restaurantIds = pageRestaurants
        .map((item) => item?.id)
        .filter((id) => typeof id === "string" && id.length > 0);
      const [profiles, roles, orders] = await Promise.all([
        managerIds.length > 0
          ? restRequest(
              token,
              buildPath("/profiles", { select: "id,full_name", id: `in.(${managerIds.join(",")})` }),
            )
          : [],
        managerIds.length > 0
          ? restRequest(
              token,
              buildPath("/user_roles", {
                select: "user_id,role",
                role: "eq.hotel_manager",
                user_id: `in.(${managerIds.join(",")})`,
              }),
            )
          : [],
        restaurantIds.length > 0
          ? restRequest(
              token,
              buildPath("/food_orders", { select: "restaurant_id", restaurant_id: `in.(${restaurantIds.join(",")})` }),
            )
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
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/restaurants$/,
    handler: async ({ token, user, body }) => {
      await assertAdmin(token, user.id);
      const rows = await restRequest(token, buildPath("/restaurants", { select: "*" }), {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body,
      });

      return { restaurant: firstRow(rows) };
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/admin\/restaurants\/([^/]+)$/,
    handler: async ({ token, user, match, body }) => {
      await assertAdmin(token, user.id);
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
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/admin\/restaurants\/([^/]+)$/,
    handler: async ({ token, user, match }) => {
      await assertAdmin(token, user.id);
      const id = decodeURIComponent(match[1]);
      await restRequest(token, buildPath("/restaurants", { id: `eq.${id}` }), { method: "DELETE" });

      return { ok: true };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/restaurants\/([^/]+)\/toggle$/,
    handler: async ({ token, user, match, body }) => {
      await assertAdmin(token, user.id);
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
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/restaurants\/([^/]+)\/grant-manager$/,
    handler: async ({ token, user, match, body }) => {
      await assertAdmin(token, user.id);
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
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/restaurants\/([^/]+)\/revoke-manager$/,
    handler: async ({ token, user, match, body }) => {
      await assertAdmin(token, user.id);
      const id = decodeURIComponent(match[1]);
      if (!body.user_id) throw new HttpError(400, "user_id is required");

      await restRequest(
        token,
        buildPath("/user_roles", {
          user_id: `eq.${body.user_id}`,
          role: `eq.hotel_manager`,
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
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/stores$/,
    handler: async ({ token, user, url }) => {
      await assertAdmin(token, user.id);
      const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
      const limit = Math.min(100, Math.max(10, Number(url.searchParams.get("limit") ?? 20)));
      const offset = (page - 1) * limit;
      const fetchLimit = limit + 1;
      const stores = await restRequest(
        token,
        buildPath("/grocery_stores", {
          select: "*",
          order: "created_at.desc",
          limit: String(fetchLimit),
          offset: String(offset),
        }),
      );
      const hasNext = (stores?.length ?? 0) > limit;
      const pageStores = (stores ?? []).slice(0, limit);

      return { stores: pageStores, page, limit, hasNext };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/stores$/,
    handler: async ({ token, user, body }) => {
      await assertAdmin(token, user.id);
      const rows = await restRequest(token, buildPath("/grocery_stores", { select: "*" }), {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body,
      });

      return { store: firstRow(rows) };
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/admin\/stores\/([^/]+)$/,
    handler: async ({ token, user, match, body }) => {
      await assertAdmin(token, user.id);
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
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/admin\/stores\/([^/]+)$/,
    handler: async ({ token, user, match }) => {
      await assertAdmin(token, user.id);
      const id = decodeURIComponent(match[1]);
      await restRequest(token, buildPath("/grocery_stores", { id: `eq.${id}` }), {
        method: "DELETE",
      });

      return { ok: true };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/users$/,
    handler: async ({ token, user, url }) => {
      await assertAdmin(token, user.id);
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

      const [profiles, roleRequests, countRows] = await Promise.all([
        restRequest(token, buildPath("/profiles", profileParams)),
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

      const pageUserIds = (profiles ?? [])
        .map((profile) => profile?.id)
        .filter((id) => typeof id === "string" && id.length > 0);
      const roles =
        pageUserIds.length > 0
          ? await restRequest(
              token,
              buildPath("/user_roles", {
                select: "user_id,role",
                user_id: `in.(${pageUserIds.join(",")})`,
              }),
            )
          : [];

      return {
        profiles: profiles ?? [],
        roles: roles ?? [],
        roleRequests: roleRequests ?? [],
        page,
        limit,
        total: Array.isArray(countRows) ? countRows.length : (profiles?.length ?? 0),
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/users\/([^/]+)\/roles\/toggle$/,
    handler: async ({ token, user, match, body }) => {
      await assertAdmin(token, user.id);
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
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/role-requests\/([^/]+)\/review$/,
    handler: async ({ token, user, match, body }) => {
      await assertAdmin(token, user.id);
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

        const listingTable =
          request.requested_role === "hotel_manager"
            ? "restaurants"
            : request.requested_role === "grocery_manager"
              ? "grocery_stores"
              : null;
        if (listingTable) {
          const existing = await restRequest(
            token,
            buildPath(`/${listingTable}`, {
              select: "id",
              manager_id: `eq.${request.user_id}`,
              limit: "1",
            }),
          );
          if (!firstRow(existing)) {
            await restRequest(token, buildPath(`/${listingTable}`, { select: "*" }), {
              method: "POST",
              headers: { Prefer: "return=representation" },
              body: {
                manager_id: request.user_id,
                name: request.business_name,
                address: request.business_address,
                town_name: request.town_name,
                pincode: request.pincode,
                lat: request.business_lat,
                lng: request.business_lng,
                is_open: true,
              },
            });
          }
        }
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
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/commissions$/,
    handler: async ({ token, user }) => {
      await assertAdmin(token, user.id);
      return {
        commissions: await getPlatformCommissions(token),
      };
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/admin\/commissions$/,
    handler: async ({ token, user, body }) => {
      await assertAdmin(token, user.id);
      const value = {
        restaurant: Number(body.restaurant ?? DEFAULT_COMMISSIONS.restaurant),
        grocery: Number(body.grocery ?? DEFAULT_COMMISSIONS.grocery),
        delivery: Number(body.delivery ?? DEFAULT_COMMISSIONS.delivery),
      };
      const saved = await savePlatformCommissions(token, value);
      return { commissions: saved };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/admin\/catalog-settings$/,
    handler: async ({ token, user }) => {
      await assertAdmin(token, user.id);
      return {
        radius_km: await getCatalogRadiusKm(token),
        limits: {
          min_km: MIN_CATALOG_RADIUS_KM,
          max_km: MAX_CATALOG_RADIUS_KM,
          default_km: DEFAULT_CATALOG_RADIUS_KM,
        },
      };
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/admin\/catalog-settings$/,
    handler: async ({ token, user, body }) => {
      await assertAdmin(token, user.id);
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

      const saved = await saveCatalogRadiusKm(token, requested);
      return {
        radius_km: saved,
        limits: {
          min_km: MIN_CATALOG_RADIUS_KM,
          max_km: MAX_CATALOG_RADIUS_KM,
          default_km: DEFAULT_CATALOG_RADIUS_KM,
        },
      };
    },
  },
];
