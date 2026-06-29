import { restRequest, serviceRoleRestRequest } from "../lib/supabase.mjs";
import { HttpError, isMissingTableError } from "../lib/http.mjs";
import { cleanText } from "../lib/request-utils.mjs";
import {
  estimateDeliveryAt,
  generateDeliveryPin,
  assertStatusAdvance,
} from "../lib/platform-helpers.mjs";
import { checkoutSchema } from "../lib/validation.mjs";

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

function normalizeDeliveryOrder(row) {
  if (!row) return row;
  return {
    ...row,
    rider_id: row.rider_id ?? row.delivery_boy_id ?? null,
  };
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

function assertCancellable(row, kind) {
  if (!row) throw new HttpError(404, `${kind} not found`);
  if (["cancelled", "delivered", "completed"].includes(row.status)) {
    throw new HttpError(400, `${kind} can no longer be cancelled`);
  }
  if (["picked_up", "out_for_delivery", "started"].includes(row.status)) {
    throw new HttpError(400, `${kind} has already started. Contact support to cancel.`);
  }
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

export const orderRoutes = [
  {
    method: "POST",
    pattern: /^\/api\/orders\/food$/,
    handler: async ({ token, user, body }) => {
      const validated = checkoutSchema.parse(body);
      if (!validated.restaurant_id) throw new HttpError(400, "restaurant_id is required");

      const items = validated.items;
      const restaurantRows = await restRequest(
        token,
        buildPath("/restaurants", {
          select: "id,name,address,town_name,pincode,lat,lng,is_open",
          id: `eq.${validated.restaurant_id}`,
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
          restaurant_id: `eq.${validated.restaurant_id}`,
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

      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const deliveryPin = generateDeliveryPin();
      const estimatedDeliveryAt = estimateDeliveryAt(
        maxPrep,
        restaurant.lat != null && restaurant.lng != null
          ? { lat: restaurant.lat, lng: restaurant.lng }
          : null,
        { lat: validated.delivery_lat, lng: validated.delivery_lng },
        distanceKm,
      );

      const orderRows = await restRequest(token, buildPath("/food_orders", { select: "*" }), {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          customer_id: user.id,
          restaurant_id: validated.restaurant_id,
          delivery_address: validated.delivery_address,
          delivery_lat: validated.delivery_lat,
          delivery_lng: validated.delivery_lng,
          pickup_address:
            [restaurant.address, restaurant.town_name, restaurant.pincode]
              .filter(Boolean)
              .join(", ") || restaurant.name,
          pickup_lat: restaurant.lat ?? null,
          pickup_lng: restaurant.lng ?? null,
          notes: validated.notes || null,
          total,
          payment_method: validated.payment_method || "cash",
          delivery_pin: deliveryPin,
          estimated_delivery_at: estimatedDeliveryAt,
          contactless_delivery: !!validated.contactless_delivery,
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
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/orders\/grocery$/,
    handler: async ({ token, user, body }) => {
      const validated = checkoutSchema.parse(body);
      if (!validated.store_id) throw new HttpError(400, "store_id is required");

      const items = validated.items;
      const storeRows = await restRequest(
        token,
        buildPath("/grocery_stores", {
          select: "id,name,address,town_name,pincode,lat,lng,is_open",
          id: `eq.${validated.store_id}`,
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
          store_id: `eq.${validated.store_id}`,
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

      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const deliveryPin = generateDeliveryPin();
      const estimatedDeliveryAt = estimateDeliveryAt(
        20,
        store.lat != null && store.lng != null ? { lat: store.lat, lng: store.lng } : null,
        { lat: validated.delivery_lat, lng: validated.delivery_lng },
        distanceKm,
      );

      const orderRows = await restRequest(token, buildPath("/grocery_orders", { select: "*" }), {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          customer_id: user.id,
          store_id: validated.store_id,
          delivery_address: validated.delivery_address,
          delivery_lat: validated.delivery_lat,
          delivery_lng: validated.delivery_lng,
          pickup_address:
            [store.address, store.town_name, store.pincode].filter(Boolean).join(", ") || store.name,
          pickup_lat: store.lat ?? null,
          pickup_lng: store.lng ?? null,
          notes: validated.notes || null,
          total,
          payment_method: validated.payment_method || "cash",
          delivery_pin: deliveryPin,
          estimated_delivery_at: estimatedDeliveryAt,
          contactless_delivery: !!validated.contactless_delivery,
        },
      });

      const order = firstRow(orderRows);
      if (!order) {
        throw new HttpError(500, "Failed to create grocery order");
      }

      try {
        await deductGroceryStock(token, validated.store_id, items);
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
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/orders\/me$/,
    handler: async ({ token, user }) => {
      const [food, grocery, rides, packages] = await Promise.all([
        restRequest(
          token,
          buildPath("/food_orders", {
            select:
              "id,status,total,delivery_address,created_at,customer_id,rider_id:delivery_boy_id,payment_method,restaurants(name)",
            customer_id: `eq.${user.id}`,
            order: "created_at.desc",
          }),
        ),
        restRequest(
          token,
          buildPath("/grocery_orders", {
            select:
              "id,status,total,delivery_address,created_at,customer_id,rider_id:delivery_boy_id,payment_method,grocery_stores(name)",
            customer_id: `eq.${user.id}`,
            order: "created_at.desc",
          }),
        ),
        restRequest(
          token,
          buildPath("/rides", {
            select:
              "id,status,fare_estimate,pickup_address,drop_address,created_at,customer_id,rider_id,vehicle_type,payment_method",
            customer_id: `eq.${user.id}`,
            order: "created_at.desc",
          }),
        ),
        restRequest(
          token,
          buildPath("/package_deliveries", {
            select:
              "id,status,fare_estimate,pickup_address,drop_address,created_at,customer_id,rider_id,package_size,payment_method",
            customer_id: `eq.${user.id}`,
            order: "created_at.desc",
          }),
        ),
      ]);

      return {
        food: await attachUserProfiles(token, food ?? [], { customer: "customer_id", rider: "rider_id" }),
        grocery: await attachUserProfiles(token, grocery ?? [], { customer: "customer_id", rider: "rider_id" }),
        rides: await attachUserProfiles(token, rides ?? [], { customer: "customer_id", rider: "rider_id" }),
        packages: await attachUserProfiles(token, packages ?? [], { customer: "customer_id", rider: "rider_id" }),
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/orders\/(ride|package|food|grocery)\/([^/]+)\/cancel$/,
    handler: async ({ token, user, match, body }) => {
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
  },
  {
    method: "GET",
    pattern: /^\/api\/track\/(ride|package|food|grocery)\/([^/]+)$/,
    handler: async ({ token, match }) => {
      const kind = match[1];
      const id = decodeURIComponent(match[2]);
      const table = {
        ride: "rides",
        package: "package_deliveries",
        food: "food_orders",
        grocery: "grocery_orders",
      }[kind];

      const select = kind === "food"
        ? "*,restaurants(name)"
        : kind === "grocery"
          ? "*,grocery_stores(name)"
          : "*";

      const rows = await restRequest(
        token,
        buildPath(`/${table}`, {
          select,
          id: `eq.${id}`,
        }),
      );

      const row = firstRow(rows);
      if (!row) return { row: null };

      const normalizedRow = kind === "food" || kind === "grocery" ? normalizeDeliveryOrder(row) : row;
      const hydratedRow = await attachUserProfiles(token, normalizedRow, {
        customer: "customer_id",
        rider: "rider_id",
      });
      const partner = hydratedRow.rider || null;

      return {
        row: {
          ...hydratedRow,
          partner: partner || hydratedRow.customer || null,
          profiles: hydratedRow.customer || null
        },
      };
    },
  },
];
