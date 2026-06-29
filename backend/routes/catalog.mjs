import { restRequest, serviceRoleRestRequest } from "../lib/supabase.mjs";
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

async function getUserCatalogLocation(token, userId) {
  const [profileRows, addressRows] = await Promise.all([
    restRequest(
      token,
      buildPath("/profiles", {
        select: "town_name,pincode",
        id: `eq.${userId}`,
        limit: "1",
      }),
    ),
    restRequest(
      token,
      buildPath("/saved_addresses", {
        select: "lat,lng,is_default,created_at",
        user_id: `eq.${userId}`,
        order: "is_default.desc,created_at.desc",
        limit: "1",
      }),
    ),
  ]);

  const profile = firstRow(profileRows);
  const address = firstRow(addressRows);
  return {
    town_name: profile?.town_name ?? null,
    pincode: profile?.pincode ?? null,
    lat: Number.isFinite(Number(address?.lat)) ? Number(address.lat) : null,
    lng: Number.isFinite(Number(address?.lng)) ? Number(address.lng) : null,
  };
}

export const catalogRoutes = [
  {
    method: "GET",
    pattern: /^\/api\/catalog\/restaurants$/,
    handler: async ({ token, user, url }) => {
      let location = await getUserCatalogLocation(token, user.id);
      const radiusKm = await getCatalogRadiusKm(token);

      const latParam = url.searchParams.get("lat");
      const lngParam = url.searchParams.get("lng");
      if (latParam && lngParam) {
        location = { ...location, lat: Number(latParam), lng: Number(lngParam) };
      }

      const restaurants = await restRequest(
        token,
        buildPath("/restaurants", {
          select: "*",
          order: "created_at.desc",
        }),
      );

      return {
        restaurants: filterCatalogRowsByLocation(restaurants, location, radiusKm),
        location: { ...location, radius_km: radiusKm },
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/catalog\/restaurants\/([^/]+)$/,
    handler: async ({ token, match }) => {
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
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/catalog\/items\/food$/,
    handler: async ({ token, user, url }) => {
      let location = await getUserCatalogLocation(token, user.id);
      const radiusKm = await getCatalogRadiusKm(token);

      const latParam = url.searchParams.get("lat");
      const lngParam = url.searchParams.get("lng");
      if (latParam && lngParam) {
        location = { ...location, lat: Number(latParam), lng: Number(lngParam) };
      }

      const restaurants = await restRequest(
        token,
        buildPath("/restaurants", {
          select: "id,town_name,pincode,lat,lng,is_open",
        }),
      );
      const visibleRestaurants = filterCatalogRowsByLocation(restaurants, location, radiusKm).filter(
        (row) => row?.is_open !== false,
      );
      const restaurantIds = visibleRestaurants.map((row) => row.id).filter(Boolean);
      if (restaurantIds.length === 0) return { items: [] };

      const items = await restRequest(
        token,
        buildPath("/menu_items", {
          select: "id,name,description,price,image_url,category,is_available,restaurant_id,restaurants(name)",
          is_available: "eq.true",
          restaurant_id: `in.(${restaurantIds.join(",")})`,
          limit: "12",
        }),
      );
      return { items: items ?? [] };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/catalog\/items\/grocery$/,
    handler: async ({ token, user, url }) => {
      let location = await getUserCatalogLocation(token, user.id);
      const radiusKm = await getCatalogRadiusKm(token);

      const latParam = url.searchParams.get("lat");
      const lngParam = url.searchParams.get("lng");
      if (latParam && lngParam) {
        location = { ...location, lat: Number(latParam), lng: Number(lngParam) };
      }

      const stores = await restRequest(
        token,
        buildPath("/grocery_stores", {
          select: "id,town_name,pincode,lat,lng,is_open",
        }),
      );
      const visibleStores = filterCatalogRowsByLocation(stores, location, radiusKm).filter(
        (row) => row?.is_open !== false,
      );
      const storeIds = visibleStores.map((row) => row.id).filter(Boolean);
      if (storeIds.length === 0) return { items: [] };

      const items = await restRequest(
        token,
        buildPath("/grocery_items", {
          select: "id,name,description,price,image_url,category,is_available,store_id,grocery_stores(name)",
          is_available: "eq.true",
          store_id: `in.(${storeIds.join(",")})`,
          limit: "12",
        }),
      );
      return { items: items ?? [] };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/catalog\/stores$/,
    handler: async ({ token, user, url }) => {
      let location = await getUserCatalogLocation(token, user.id);
      const radiusKm = await getCatalogRadiusKm(token);

      const latParam = url.searchParams.get("lat");
      const lngParam = url.searchParams.get("lng");
      if (latParam && lngParam) {
        location = { ...location, lat: Number(latParam), lng: Number(lngParam) };
      }

      const stores = await restRequest(
        token,
        buildPath("/grocery_stores", {
          select: "*",
          order: "created_at.desc",
        }),
      );

      return {
        stores: filterCatalogRowsByLocation(stores, location, radiusKm),
        location: { ...location, radius_km: radiusKm },
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/catalog\/stores\/([^/]+)$/,
    handler: async ({ token, match }) => {
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
    },
  },
];
