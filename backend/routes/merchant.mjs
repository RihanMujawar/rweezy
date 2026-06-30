import { restRequest, serviceRoleRestRequest, getRoles } from "../lib/supabase.mjs";
import { HttpError } from "../lib/http.mjs";
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

async function getAssignedRestaurant(token, userId) {
  const rows = await restRequest(token, buildPath("/restaurants", {
    select: "id",
    manager_id: `eq.${userId}`,
    limit: "1"
  }));
  const restaurant = firstRow(rows);
  if (!restaurant) throw new HttpError(403, "No restaurant assigned to this account");
  return restaurant.id;
}

async function getAssignedStore(token, userId) {
  const rows = await restRequest(token, buildPath("/grocery_stores", {
    select: "id",
    manager_id: `eq.${userId}`,
    limit: "1"
  }));
  const store = firstRow(rows);
  if (!store) throw new HttpError(403, "No store assigned to this account");
  return store.id;
}

export const merchantRoutes = [
  {
    method: "GET",
    pattern: /^\/api\/hotel\/dashboard$/,
    handler: async ({ token, user }) => {
      const restaurantRows = await restRequest(
        token,
        buildPath("/restaurants", {
          select: "*",
          manager_id: `eq.${user.id}`,
          limit: "1"
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
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/hotel\/restaurant$/,
    handler: async ({ token, user, body }) => {
      if (body.id) {
         // Verify ownership if updating
         const assignedId = await getAssignedRestaurant(token, user.id);
         if (body.id !== assignedId) throw new HttpError(403, "You can only update your own restaurant");
      }
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
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/hotel\/menu$/,
    handler: async ({ token, user }) => {
      const restaurantId = await getAssignedRestaurant(token, user.id).catch(() => null);
      if (!restaurantId) {
        return { restaurantId: null, items: [] };
      }

      const items = await restRequest(
        token,
        buildPath("/menu_items", {
          select: "*",
          restaurant_id: `eq.${restaurantId}`,
          order: "created_at.desc",
        }),
      );

      return { restaurantId: restaurantId, items: items ?? [] };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/hotel\/menu$/,
    handler: async ({ token, user, body }) => {
      const restaurantId = await getAssignedRestaurant(token, user.id);

      const rows = await restRequest(token, buildPath("/menu_items", { select: "*" }), {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          restaurant_id: restaurantId,
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
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/hotel\/menu\/([^/]+)$/,
    handler: async ({ token, user, match, body }) => {
      const restaurantId = await getAssignedRestaurant(token, user.id);
      const id = decodeURIComponent(match[1]);

      const rows = await restRequest(
        token,
        buildPath("/menu_items", {
          id: `eq.${id}`,
          restaurant_id: `eq.${restaurantId}`,
          select: "*"
        }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body,
        },
      );

      return { item: firstRow(rows) };
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/hotel\/menu\/([^/]+)$/,
    handler: async ({ token, user, match }) => {
      const restaurantId = await getAssignedRestaurant(token, user.id);
      const id = decodeURIComponent(match[1]);
      await restRequest(token, buildPath("/menu_items", {
        id: `eq.${id}`,
        restaurant_id: `eq.${restaurantId}`
      }), { method: "DELETE" });

      return { ok: true };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/hotel\/menu\/([^/]+)\/toggle$/,
    handler: async ({ token, user, match, body }) => {
      const restaurantId = await getAssignedRestaurant(token, user.id);
      const id = decodeURIComponent(match[1]);
      const rows = await restRequest(
        token,
        buildPath("/menu_items", {
          id: `eq.${id}`,
          restaurant_id: `eq.${restaurantId}`,
          select: "*"
        }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { is_available: !!body.is_available },
        },
      );

      return { item: firstRow(rows) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/hotel\/orders$/,
    handler: async ({ token, user }) => {
      const restaurantId = await getAssignedRestaurant(token, user.id).catch(() => null);
      if (!restaurantId) {
        return { restaurantId: null, orders: [] };
      }

      const orders = await restRequest(
        token,
        buildPath("/food_orders", {
          select:
            "id,status,total,delivery_address,delivery_lat,delivery_lng,notes,created_at,customer_id,food_order_items(id,name,quantity,price)",
          restaurant_id: `eq.${restaurantId}`,
          order: "created_at.desc",
        }),
      );

      return {
        restaurantId: restaurantId,
        orders: await attachUserProfiles(token, orders ?? [], { customer: "customer_id" }),
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/hotel\/orders\/([^/]+)\/advance$/,
    handler: async ({ token, user, match, body }) => {
      const restaurantId = await getAssignedRestaurant(token, user.id);
      const id = decodeURIComponent(match[1]);
      const rows = await restRequest(
        token,
        buildPath("/food_orders", {
          id: `eq.${id}`,
          restaurant_id: `eq.${restaurantId}`,
          select: "*"
        }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { status: body.status },
        },
      );

      const order = firstRow(rows);
      if (order) {
        // Notify Customer
        void (async () => {
          try {
            const { sendNotification } = await import("../lib/notifications.mjs");
            const statusLabel = body.status.replace(/_/g, " ");
            await sendNotification(order.customer_id, {
              title: "Food Order Update",
              body: `Your order status is now: ${statusLabel}.`,
              data: { type: "order_status_update", kind: "food", id: order.id, status: body.status },
            });
          } catch (error) {
            console.warn("Failed to send food order status update notification:", error.message);
          }
        })();
      }
      return { order };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/hotel\/orders\/([^/]+)\/reject$/,
    handler: async ({ token, user, match, body }) => {
      const restaurantId = await getAssignedRestaurant(token, user.id);
      const id = decodeURIComponent(match[1]);
      const rows = await restRequest(
        token,
        buildPath("/food_orders", {
          id: `eq.${id}`,
          restaurant_id: `eq.${restaurantId}`,
          select: "*"
        }),
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

      const order = firstRow(rows);
      if (order) {
        // Notify Customer
        void (async () => {
          try {
            const { sendNotification } = await import("../lib/notifications.mjs");
            const statusLabel = body.status.replace(/_/g, " ");
            await sendNotification(order.customer_id, {
              title: "Grocery Order Update",
              body: `Your order status is now: ${statusLabel}.`,
              data: { type: "order_status_update", kind: "grocery", id: order.id, status: body.status },
            });
          } catch (error) {
            console.warn("Failed to send grocery order status update notification:", error.message);
          }
        })();
      }
      return { order };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/hotel\/history$/,
    handler: async ({ token, user }) => {
      const restaurantId = await getAssignedRestaurant(token, user.id).catch(() => null);
      if (!restaurantId) {
        return { restaurantId: null, orders: [] };
      }

      const orders = await restRequest(
        token,
        buildPath("/food_orders", {
          select:
            "id,status,total,delivery_address,delivery_lat,delivery_lng,notes,created_at,customer_id,food_order_items(id,name,quantity,price)",
          restaurant_id: `eq.${restaurantId}`,
          order: "created_at.desc",
          limit: "100",
        }),
      );

      return {
        restaurantId: restaurantId,
        orders: await attachUserProfiles(token, orders ?? [], { customer: "customer_id" }),
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/grocery\/dashboard$/,
    handler: async ({ token, user }) => {
      const storeRows = await restRequest(
        token,
        buildPath("/grocery_stores", {
          select: "*",
          manager_id: `eq.${user.id}`,
          limit: "1"
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
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/grocery\/store$/,
    handler: async ({ token, user, body }) => {
      if (body.id) {
         const assignedId = await getAssignedStore(token, user.id);
         if (body.id !== assignedId) throw new HttpError(403, "You can only update your own store");
      }
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
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/grocery\/items$/,
    handler: async ({ token, user }) => {
      const storeId = await getAssignedStore(token, user.id).catch(() => null);
      if (!storeId) {
        return { storeId: null, items: [] };
      }

      const items = await restRequest(
        token,
        buildPath("/grocery_items", {
          select: "*",
          store_id: `eq.${storeId}`,
          order: "created_at.desc",
        }),
      );

      return { storeId: storeId, items: items ?? [] };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/grocery\/items$/,
    handler: async ({ token, user, body }) => {
      const storeId = await getAssignedStore(token, user.id);

      const rows = await restRequest(token, buildPath("/grocery_items", { select: "*" }), {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          store_id: storeId,
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
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/grocery\/items\/([^/]+)$/,
    handler: async ({ token, user, match, body }) => {
      const storeId = await getAssignedStore(token, user.id);
      const id = decodeURIComponent(match[1]);
      const rows = await restRequest(
        token,
        buildPath("/grocery_items", {
          id: `eq.${id}`,
          store_id: `eq.${storeId}`,
          select: "*"
        }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body,
        },
      );

      return { item: firstRow(rows) };
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/grocery\/items\/([^/]+)$/,
    handler: async ({ token, user, match }) => {
      const storeId = await getAssignedStore(token, user.id);
      const id = decodeURIComponent(match[1]);
      await restRequest(token, buildPath("/grocery_items", {
        id: `eq.${id}`,
        store_id: `eq.${storeId}`
      }), { method: "DELETE" });

      return { ok: true };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/grocery\/items\/([^/]+)\/toggle$/,
    handler: async ({ token, user, match, body }) => {
      const storeId = await getAssignedStore(token, user.id);
      const id = decodeURIComponent(match[1]);
      const rows = await restRequest(
        token,
        buildPath("/grocery_items", {
          id: `eq.${id}`,
          store_id: `eq.${storeId}`,
          select: "*"
        }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { is_available: !!body.is_available },
        },
      );

      return { item: firstRow(rows) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/grocery\/orders$/,
    handler: async ({ token, user }) => {
      const storeId = await getAssignedStore(token, user.id).catch(() => null);
      if (!storeId) {
        return { storeId: null, orders: [] };
      }

      const orders = await restRequest(
        token,
        buildPath("/grocery_orders", {
          select:
            "id,status,total,delivery_address,delivery_lat,delivery_lng,notes,created_at,customer_id,grocery_order_items(id,name,quantity,price)",
          store_id: `eq.${storeId}`,
          order: "created_at.desc",
        }),
      );

      return {
        storeId: storeId,
        orders: await attachUserProfiles(token, orders ?? [], { customer: "customer_id" }),
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/grocery\/orders\/([^/]+)\/advance$/,
    handler: async ({ token, user, match, body }) => {
      const storeId = await getAssignedStore(token, user.id);
      const id = decodeURIComponent(match[1]);
      const rows = await restRequest(
        token,
        buildPath("/grocery_orders", {
          id: `eq.${id}`,
          store_id: `eq.${storeId}`,
          select: "*"
        }),
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { status: body.status },
        },
      );

      return { order: firstRow(rows) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/grocery\/history$/,
    handler: async ({ token, user }) => {
      const storeId = await getAssignedStore(token, user.id).catch(() => null);
      if (!storeId) {
        return { storeId: null, orders: [] };
      }

      const orders = await restRequest(
        token,
        buildPath("/grocery_orders", {
          select:
            "id,status,total,delivery_address,delivery_lat,delivery_lng,notes,created_at,customer_id,grocery_order_items(id,name,quantity,price)",
          store_id: `eq.${storeId}`,
          order: "created_at.desc",
          limit: "100",
        }),
      );

      return {
        storeId: storeId,
        orders: await attachUserProfiles(token, orders ?? [], { customer: "customer_id" }),
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/grocery\/alerts$/,
    handler: async ({ token, user }) => {
      const storeId = await getAssignedStore(token, user.id).catch(() => null);
      if (!storeId) return { lowStock: [], expiringSoon: [] };

      const items = await restRequest(
        token,
        buildPath("/grocery_items", {
          select: "id,name,stock_quantity,low_stock_threshold,expiry_date,is_available",
          store_id: `eq.${storeId}`,
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
    },
  },
];
