type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function apiRequest<T>(
  path: string,
  options: {
    method?: ApiMethod;
    body?: unknown;
  } = {},
) {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    throw new Error(
      typeof payload === "object" && payload !== null && "error" in payload
        ? String(payload.error)
        : "Request failed",
    );
  }

  return payload as T;
}

export const api = {
  auth: {
    login: (payload: { email: string; password: string }) =>
      apiRequest<{ user: { id: string; email?: string | null }; roles: string[] }>("/api/auth/login", {
        method: "POST",
        body: payload,
      }),
    register: (payload: { full_name: string; email: string; password: string }) =>
      apiRequest<{
        user: { id: string; email?: string | null } | null;
        roles: string[];
        authenticated: boolean;
      }>("/api/auth/register", {
        method: "POST",
        body: payload,
      }),
    logout: () => apiRequest<{ ok: true }>("/api/auth/logout", { method: "POST" }),
    getMe: () => apiRequest<{ user: { id: string; email?: string | null } | null; roles: string[] }>("/api/auth/me"),
  },

  map: {
    getRoute: (fromLat: number, fromLng: number, toLat: number, toLng: number) =>
      apiRequest<{ route: { lat: number; lng: number }[] }>(
        `/api/map/route?fromLat=${fromLat}&fromLng=${fromLng}&toLat=${toLat}&toLng=${toLng}`,
      ),
  },

  profile: {
    get: () => apiRequest<{ profile: { full_name?: string | null; phone?: string | null } | null }>("/api/profile"),
    update: (payload: { full_name: string; phone: string }) =>
      apiRequest<{ profile: { full_name?: string | null; phone?: string | null } | null }>("/api/profile", {
        method: "PUT",
        body: payload,
      }),
  },

  liveLocation: {
    update: (payload: {
      table: "rides" | "package_deliveries" | "food_orders" | "grocery_orders";
      row_id: string;
      rider_lat: number;
      rider_lng: number;
    }) => apiRequest<{ row: unknown }>("/api/live-location", { method: "POST", body: payload }),
  },

  catalog: {
    getRestaurants: () => apiRequest<{ restaurants: unknown[] }>("/api/catalog/restaurants"),
    getRestaurant: (restaurantId: string) =>
      apiRequest<{ restaurant: unknown | null; items: unknown[] }>(`/api/catalog/restaurants/${restaurantId}`),
    getStores: () => apiRequest<{ stores: unknown[] }>("/api/catalog/stores"),
    getStore: (storeId: string) =>
      apiRequest<{ store: unknown | null; items: unknown[] }>(`/api/catalog/stores/${storeId}`),
  },

  orders: {
    placeFood: (payload: {
      restaurant_id: string;
      delivery_address: string;
      notes: string;
      total: number;
      items: { id: string; name: string; price: number; quantity: number }[];
    }) => apiRequest<{ order: unknown }>("/api/orders/food", { method: "POST", body: payload }),
    placeGrocery: (payload: {
      store_id: string;
      delivery_address: string;
      notes: string;
      total: number;
      items: { id: string; name: string; price: number; quantity: number }[];
    }) => apiRequest<{ order: unknown }>("/api/orders/grocery", { method: "POST", body: payload }),
    getMine: () =>
      apiRequest<{ food: unknown[]; grocery: unknown[]; rides: unknown[]; packages: unknown[] }>("/api/orders/me"),
  },

  track: {
    get: (kind: "ride" | "package" | "food" | "grocery", id: string) =>
      apiRequest<{ row: unknown | null }>(`/api/track/${kind}/${id}`),
  },

  rides: {
    create: (payload: {
      pickup_lat: number;
      pickup_lng: number;
      pickup_address: string;
      drop_lat: number;
      drop_lng: number;
      drop_address: string;
      fare_estimate: number;
      vehicle_type: string;
      notes: string;
    }) => apiRequest<{ ride: unknown }>("/api/rides", { method: "POST", body: payload }),
  },

  packages: {
    create: (payload: {
      pickup_lat: number;
      pickup_lng: number;
      pickup_address: string;
      drop_lat: number;
      drop_lng: number;
      drop_address: string;
      fare_estimate: number;
      package_size: string;
      receiver_name: string;
      receiver_phone: string;
      notes: string;
    }) => apiRequest<{ packageDelivery: unknown }>("/api/packages", { method: "POST", body: payload }),
  },

  admin: {
    getStats: () =>
      apiRequest<{
        users: number;
        restaurants: number;
        foodOrders: number;
        rides: number;
        packages: number;
        stores: number;
      }>("/api/admin/stats"),
    getRestaurants: () =>
      apiRequest<{ restaurants: unknown[]; profiles: unknown[]; roles: unknown[]; orders: unknown[] }>(
        "/api/admin/restaurants",
      ),
    createRestaurant: (payload: Record<string, unknown>) =>
      apiRequest<{ restaurant: unknown }>("/api/admin/restaurants", { method: "POST", body: payload }),
    updateRestaurant: (id: string, payload: Record<string, unknown>) =>
      apiRequest<{ restaurant: unknown }>(`/api/admin/restaurants/${id}`, { method: "PUT", body: payload }),
    deleteRestaurant: (id: string) =>
      apiRequest<{ ok: true }>(`/api/admin/restaurants/${id}`, { method: "DELETE" }),
    toggleRestaurant: (id: string, is_open: boolean) =>
      apiRequest<{ restaurant: unknown }>(`/api/admin/restaurants/${id}/toggle`, {
        method: "POST",
        body: { is_open },
      }),
    grantRestaurantManager: (id: string, user_id: string) =>
      apiRequest<{ restaurant: unknown }>(`/api/admin/restaurants/${id}/grant-manager`, {
        method: "POST",
        body: { user_id },
      }),
    revokeRestaurantManager: (id: string, user_id: string) =>
      apiRequest<{ restaurant: unknown }>(`/api/admin/restaurants/${id}/revoke-manager`, {
        method: "POST",
        body: { user_id },
      }),
    getStores: () => apiRequest<{ stores: unknown[] }>("/api/admin/stores"),
    createStore: (payload: Record<string, unknown>) =>
      apiRequest<{ store: unknown }>("/api/admin/stores", { method: "POST", body: payload }),
    updateStore: (id: string, payload: Record<string, unknown>) =>
      apiRequest<{ store: unknown }>(`/api/admin/stores/${id}`, { method: "PUT", body: payload }),
    deleteStore: (id: string) => apiRequest<{ ok: true }>(`/api/admin/stores/${id}`, { method: "DELETE" }),
    getUsers: () => apiRequest<{ profiles: unknown[]; roles: unknown[] }>("/api/admin/users"),
    toggleRole: (userId: string, role: string, has_role: boolean) =>
      apiRequest<{ ok: true }>(`/api/admin/users/${userId}/roles/toggle`, {
        method: "POST",
        body: { role, has_role },
      }),
  },

  hotel: {
    getDashboard: () =>
      apiRequest<{ restaurant: unknown | null; stats: { total: number; pending: number; today: number } }>(
        "/api/hotel/dashboard",
      ),
    saveRestaurant: (payload: Record<string, unknown>) =>
      apiRequest<{ restaurant: unknown | null }>("/api/hotel/restaurant", { method: "PUT", body: payload }),
    getMenu: () => apiRequest<{ restaurantId: string | null; items: unknown[] }>("/api/hotel/menu"),
    createMenuItem: (payload: Record<string, unknown>) =>
      apiRequest<{ item: unknown }>("/api/hotel/menu", { method: "POST", body: payload }),
    updateMenuItem: (id: string, payload: Record<string, unknown>) =>
      apiRequest<{ item: unknown }>(`/api/hotel/menu/${id}`, { method: "PUT", body: payload }),
    deleteMenuItem: (id: string) => apiRequest<{ ok: true }>(`/api/hotel/menu/${id}`, { method: "DELETE" }),
    toggleMenuItem: (id: string, is_available: boolean) =>
      apiRequest<{ item: unknown }>(`/api/hotel/menu/${id}/toggle`, {
        method: "POST",
        body: { is_available },
      }),
    getOrders: () => apiRequest<{ restaurantId: string | null; orders: unknown[] }>("/api/hotel/orders"),
    advanceOrder: (id: string, status: string) =>
      apiRequest<{ order: unknown }>(`/api/hotel/orders/${id}/advance`, {
        method: "POST",
        body: { status },
      }),
  },

  groceryAdmin: {
    getDashboard: () =>
      apiRequest<{ store: unknown | null; stats: { total: number; pending: number; today: number } }>(
        "/api/grocery/dashboard",
      ),
    saveStore: (payload: Record<string, unknown>) =>
      apiRequest<{ store: unknown | null }>("/api/grocery/store", { method: "PUT", body: payload }),
    getItems: () => apiRequest<{ storeId: string | null; items: unknown[] }>("/api/grocery/items"),
    createItem: (payload: Record<string, unknown>) =>
      apiRequest<{ item: unknown }>("/api/grocery/items", { method: "POST", body: payload }),
    updateItem: (id: string, payload: Record<string, unknown>) =>
      apiRequest<{ item: unknown }>(`/api/grocery/items/${id}`, { method: "PUT", body: payload }),
    deleteItem: (id: string) => apiRequest<{ ok: true }>(`/api/grocery/items/${id}`, { method: "DELETE" }),
    toggleItem: (id: string, is_available: boolean) =>
      apiRequest<{ item: unknown }>(`/api/grocery/items/${id}/toggle`, {
        method: "POST",
        body: { is_available },
      }),
    getOrders: () => apiRequest<{ storeId: string | null; orders: unknown[] }>("/api/grocery/orders"),
    advanceOrder: (id: string, status: string) =>
      apiRequest<{ order: unknown }>(`/api/grocery/orders/${id}/advance`, {
        method: "POST",
        body: { status },
      }),
  },

  delivery: {
    getAvailable: () => apiRequest<{ food: unknown[]; grocery: unknown[] }>("/api/delivery/available"),
    getActive: () => apiRequest<{ food: unknown[]; grocery: unknown[] }>("/api/delivery/active"),
    accept: (kind: "food" | "grocery", id: string) =>
      apiRequest<{ order: unknown }>(`/api/delivery/${kind}/${id}/accept`, { method: "POST" }),
    advance: (kind: "food" | "grocery", id: string, status: string) =>
      apiRequest<{ order: unknown }>(`/api/delivery/${kind}/${id}/advance`, {
        method: "POST",
        body: { status },
      }),
  },

  rider: {
    getJobs: () => apiRequest<{ rides: unknown[]; packages: unknown[] }>("/api/rider/jobs"),
    getActive: (search?: { id?: string; kind?: "ride" | "package" }) => {
      const params = new URLSearchParams();
      if (search?.id) params.set("id", search.id);
      if (search?.kind) params.set("kind", search.kind);
      const query = params.toString();
      return apiRequest<{ job: unknown | null; table: "rides" | "package_deliveries" }>(
        `/api/rider/active${query ? `?${query}` : ""}`,
      );
    },
    acceptRide: (id: string) =>
      apiRequest<{ ride: unknown }>(`/api/rider/rides/${id}/accept`, { method: "POST" }),
    acceptPackage: (id: string) =>
      apiRequest<{ packageDelivery: unknown }>(`/api/rider/packages/${id}/accept`, { method: "POST" }),
    advance: (table: "rides" | "package_deliveries", id: string, status: string) =>
      apiRequest<{ job: unknown }>(`/api/rider/${table}/${id}/advance`, {
        method: "POST",
        body: { status },
      }),
    cancel: (table: "rides" | "package_deliveries", id: string) =>
      apiRequest<{ job: unknown }>(`/api/rider/${table}/${id}/cancel`, { method: "POST" }),
  },
};
