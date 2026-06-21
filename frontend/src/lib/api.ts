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
    login: (payload: { email?: string; phone?: string; password: string }) =>
      apiRequest<{ user: { id: string; email?: string | null }; roles: string[] }>(
        "/api/auth/login",
        {
          method: "POST",
          body: payload,
        },
      ),
    sendPhoneOtp: (payload: {
      phone: string;
      purpose: "login" | "register" | "reset_password";
      email?: string;
    }) =>
      apiRequest<{ ok: true; message: string }>("/api/auth/phone/send-otp", {
        method: "POST",
        body: payload,
      }),
    verifyPhoneOtp: (payload: {
      phone: string;
      code: string;
      purpose: "login" | "register" | "reset_password";
      email?: string;
    }) =>
      apiRequest<{
        ok?: true;
        phoneVerificationToken?: string;
        user?: { id: string; email?: string | null };
        roles?: string[];
      }>("/api/auth/phone/verify-otp", {
        method: "POST",
        body: payload,
      }),
    resendEmailVerification: (payload: { email: string }) =>
      apiRequest<{ ok: true; message: string }>("/api/auth/email/resend-verification", {
        method: "POST",
        body: payload,
      }),
    requestPasswordReset: (payload: { phone: string }) =>
      apiRequest<{ ok: true; message: string; phoneHint?: string | null }>(
        "/api/auth/password-reset/request",
        {
          method: "POST",
          body: payload,
        },
      ),
    completePasswordReset: (payload: {
      phone: string;
      phone_verification_token: string;
      password: string;
    }) =>
      apiRequest<{
        ok: true;
        message: string;
        user: { id: string; email?: string | null };
        roles: string[];
      }>("/api/auth/password-reset/complete", {
        method: "POST",
        body: payload,
      }),
    register: (payload: {
      full_name: string;
      email?: string;
      phone: string;
      password: string;
      phone_verification_token: string;
      role?: string;
      requested_role?: string;
      business_name?: string;
      role_message?: string;
    }) =>
      apiRequest<{
        user: { id: string; email?: string | null } | null;
        roles: string[];
        authenticated: boolean;
        emailVerificationRequired?: boolean;
        roleRequestPending?: boolean;
        roleRequestWarning?: string | null;
      }>("/api/auth/register", {
        method: "POST",
        body: payload,
      }),
    logout: () => apiRequest<{ ok: true }>("/api/auth/logout", { method: "POST" }),
    getMe: () =>
      apiRequest<{ user: { id: string; email?: string | null } | null; roles: string[] }>(
        "/api/auth/me",
      ),
    loginWithFirebaseGoogle: (payload: { id_token: string }) =>
      apiRequest<{ user: { id: string; email?: string | null }; roles: string[] }>(
        "/api/auth/firebase-google",
        {
          method: "POST",
          body: payload,
        },
      ),
  },

  map: {
    getRoute: (fromLat: number, fromLng: number, toLat: number, toLng: number) =>
      apiRequest<{ route: { lat: number; lng: number }[] }>(
        `/api/map/route?fromLat=${fromLat}&fromLng=${fromLng}&toLat=${toLat}&toLng=${toLng}`,
      ),
  },

  profile: {
    get: () =>
      apiRequest<{ profile: { full_name?: string | null; phone?: string | null } | null }>(
        "/api/profile",
      ),
    update: (payload: { full_name: string; phone: string }) =>
      apiRequest<{ profile: { full_name?: string | null; phone?: string | null } | null }>(
        "/api/profile",
        {
          method: "PUT",
          body: payload,
        },
      ),
    getAddresses: () => apiRequest<{ addresses: unknown[] }>("/api/profile/addresses"),
    addAddress: (payload: {
      label: string;
      address: string;
      lat?: number | null;
      lng?: number | null;
      is_default?: boolean;
    }) =>
      apiRequest<{ address: unknown }>("/api/profile/addresses", { method: "POST", body: payload }),
    deleteAddress: (id: string) =>
      apiRequest<{ ok: true }>(`/api/profile/addresses/${id}`, { method: "DELETE" }),
  },

  notifications: {
    saveToken: (payload: {
      token: string;
      platform?: "web" | "android" | "ios";
      user_agent?: string;
      device_label?: string;
    }) =>
      apiRequest<{ pushToken: unknown }>("/api/notifications/token", {
        method: "POST",
        body: payload,
      }),
    sendTest: (payload: {
      token?: string;
      user_id?: string;
      title?: string;
      body?: string;
      data?: Record<string, string>;
    }) =>
      apiRequest<{
        sent: number;
        failed: number;
        results: Array<{ token: string; ok: boolean; error?: string }>;
      }>("/api/admin/notifications/test", {
        method: "POST",
        body: payload,
      }),
  },

  roleRequests: {
    getMine: () => apiRequest<{ requests: unknown[] }>("/api/role-requests"),
    create: (payload: { requested_role: string; business_name?: string; message?: string }) =>
      apiRequest<{ request: unknown }>("/api/role-requests", { method: "POST", body: payload }),
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
    getRestaurants: () =>
      apiRequest<{ restaurants: unknown[]; location: null }>("/api/catalog/restaurants"),
    getRestaurant: (restaurantId: string) =>
      apiRequest<{ restaurant: unknown | null; items: unknown[] }>(
        `/api/catalog/restaurants/${restaurantId}`,
      ),
    getStores: () => apiRequest<{ stores: unknown[]; location: null }>("/api/catalog/stores"),
    getStore: (storeId: string) =>
      apiRequest<{ store: unknown | null; items: unknown[] }>(`/api/catalog/stores/${storeId}`),
    getPopularFoodItems: () => apiRequest<{ items: unknown[] }>("/api/catalog/items/food"),
    getPopularGroceryItems: () => apiRequest<{ items: unknown[] }>("/api/catalog/items/grocery"),
  },

  orders: {
    placeFood: (payload: {
      restaurant_id: string;
      delivery_address: string;
      delivery_lat: number;
      delivery_lng: number;
      notes: string;
      total: number;
      payment_method?: string;
      contactless_delivery?: boolean;
      items: { id: string; name: string; price: number; quantity: number }[];
    }) => apiRequest<{ order: unknown }>("/api/orders/food", { method: "POST", body: payload }),
    placeGrocery: (payload: {
      store_id: string;
      delivery_address: string;
      delivery_lat: number;
      delivery_lng: number;
      notes: string;
      total: number;
      payment_method?: string;
      items: { id: string; name: string; price: number; quantity: number }[];
    }) => apiRequest<{ order: unknown }>("/api/orders/grocery", { method: "POST", body: payload }),
    getMine: () =>
      apiRequest<{ food: unknown[]; grocery: unknown[]; rides: unknown[]; packages: unknown[] }>(
        "/api/orders/me",
      ),
    cancel: (kind: "ride" | "package" | "food" | "grocery", id: string, reason: string) =>
      apiRequest<{ row: unknown }>(`/api/orders/${kind}/${id}/cancel`, {
        method: "POST",
        body: { reason },
      }),
  },

  track: {
    get: (kind: "ride" | "package" | "food" | "grocery", id: string) =>
      apiRequest<{ row: unknown | null }>(`/api/track/${kind}/${id}`),
  },

  chat: {
    get: (kind: "ride" | "package" | "food" | "grocery", id: string) =>
      apiRequest<{
        messages: unknown[];
        participant: { customer_id: string; partner_id: string | null };
      }>(`/api/chat/${kind}/${id}`),
    send: (kind: "ride" | "package" | "food" | "grocery", id: string, message: string) =>
      apiRequest<{ message: unknown }>(`/api/chat/${kind}/${id}`, {
        method: "POST",
        body: { message },
      }),
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
      payment_method?: string;
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
      payment_method?: string;
    }) =>
      apiRequest<{ packageDelivery: unknown }>("/api/packages", { method: "POST", body: payload }),
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
    getHealth: () =>
      apiRequest<{
        pendingRoleRequests: number;
        foodOrdersNeedingAttention: number;
        groceryOrdersNeedingAttention: number;
        readyFoodWithoutRider: number;
      }>("/api/admin/health"),
    getAnalytics: () =>
      apiRequest<{
        restaurantIncome: unknown[];
        groceryStoreIncome: unknown[];
        deliveryBoys: unknown[];
        totals: {
          restaurantTodayIncome: number;
          restaurantMonthIncome: number;
          groceryTodayIncome: number;
          groceryMonthIncome: number;
          deliveryBoys: number;
          deliveriesToday: number;
          deliveriesMonth: number;
          trackedKm: number;
        };
      }>("/api/admin/analytics"),
    getRestaurants: (params?: { page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.page) query.set("page", String(params.page));
      if (params?.limit) query.set("limit", String(params.limit));
      const qs = query.toString();
      return apiRequest<{
        restaurants: unknown[];
        profiles: unknown[];
        roles: unknown[];
        orders: unknown[];
        page: number;
        limit: number;
        hasNext: boolean;
      }>(`/api/admin/restaurants${qs ? `?${qs}` : ""}`);
    },
    createRestaurant: (payload: Record<string, unknown>) =>
      apiRequest<{ restaurant: unknown }>("/api/admin/restaurants", {
        method: "POST",
        body: payload,
      }),
    updateRestaurant: (id: string, payload: Record<string, unknown>) =>
      apiRequest<{ restaurant: unknown }>(`/api/admin/restaurants/${id}`, {
        method: "PUT",
        body: payload,
      }),
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
    getStores: (params?: { page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.page) query.set("page", String(params.page));
      if (params?.limit) query.set("limit", String(params.limit));
      const qs = query.toString();
      return apiRequest<{ stores: unknown[]; page: number; limit: number; hasNext: boolean }>(
        `/api/admin/stores${qs ? `?${qs}` : ""}`,
      );
    },
    createStore: (payload: Record<string, unknown>) =>
      apiRequest<{ store: unknown }>("/api/admin/stores", { method: "POST", body: payload }),
    updateStore: (id: string, payload: Record<string, unknown>) =>
      apiRequest<{ store: unknown }>(`/api/admin/stores/${id}`, { method: "PUT", body: payload }),
    deleteStore: (id: string) =>
      apiRequest<{ ok: true }>(`/api/admin/stores/${id}`, { method: "DELETE" }),
    getUsers: (params?: { search?: string; page?: number; limit?: number }) => {
      const query = new URLSearchParams();
      if (params?.search) query.set("search", params.search);
      if (params?.page) query.set("page", String(params.page));
      if (params?.limit) query.set("limit", String(params.limit));
      const qs = query.toString();
      return apiRequest<{
        profiles: unknown[];
        roles: unknown[];
        roleRequests: unknown[];
        page: number;
        limit: number;
        total: number;
      }>(`/api/admin/users${qs ? `?${qs}` : ""}`);
    },
    getCommissions: () =>
      apiRequest<{ commissions: { restaurant: number; grocery: number; delivery: number } }>(
        "/api/admin/commissions",
      ),
    saveCommissions: (payload: { restaurant: number; grocery: number; delivery: number }) =>
      apiRequest<{ commissions: { restaurant: number; grocery: number; delivery: number } }>(
        "/api/admin/commissions",
        { method: "PUT", body: payload },
      ),
    getCatalogSettings: () =>
      apiRequest<{
        radius_km: number;
        limits: { min_km: number; max_km: number; default_km: number };
      }>("/api/admin/catalog-settings"),
    saveCatalogSettings: (payload: { radius_km: number }) =>
      apiRequest<{
        radius_km: number;
        limits: { min_km: number; max_km: number; default_km: number };
      }>("/api/admin/catalog-settings", { method: "PUT", body: payload }),
    toggleRole: (userId: string, role: string, has_role: boolean) =>
      apiRequest<{ ok: true }>(`/api/admin/users/${userId}/roles/toggle`, {
        method: "POST",
        body: { role, has_role },
      }),
    reviewRoleRequest: (id: string, decision: "approved" | "rejected") =>
      apiRequest<{ request: unknown }>(`/api/admin/role-requests/${id}/review`, {
        method: "POST",
        body: { decision },
      }),
  },

  hotel: {
    getDashboard: () =>
      apiRequest<{
        restaurant: unknown | null;
        stats: { total: number; pending: number; today: number };
      }>("/api/hotel/dashboard"),
    saveRestaurant: (payload: Record<string, unknown>) =>
      apiRequest<{ restaurant: unknown | null }>("/api/hotel/restaurant", {
        method: "PUT",
        body: payload,
      }),
    getMenu: () => apiRequest<{ restaurantId: string | null; items: unknown[] }>("/api/hotel/menu"),
    createMenuItem: (payload: Record<string, unknown>) =>
      apiRequest<{ item: unknown }>("/api/hotel/menu", { method: "POST", body: payload }),
    updateMenuItem: (id: string, payload: Record<string, unknown>) =>
      apiRequest<{ item: unknown }>(`/api/hotel/menu/${id}`, { method: "PUT", body: payload }),
    deleteMenuItem: (id: string) =>
      apiRequest<{ ok: true }>(`/api/hotel/menu/${id}`, { method: "DELETE" }),
    toggleMenuItem: (id: string, is_available: boolean) =>
      apiRequest<{ item: unknown }>(`/api/hotel/menu/${id}/toggle`, {
        method: "POST",
        body: { is_available },
      }),
    getOrders: () =>
      apiRequest<{ restaurantId: string | null; orders: unknown[] }>("/api/hotel/orders"),
    advanceOrder: (id: string, status: string) =>
      apiRequest<{ order: unknown }>(`/api/hotel/orders/${id}/advance`, {
        method: "POST",
        body: { status },
      }),
    rejectOrder: (id: string, reason?: string) =>
      apiRequest<{ order: unknown }>(`/api/hotel/orders/${id}/reject`, {
        method: "POST",
        body: { reason },
      }),
    getHistory: () =>
      apiRequest<{ restaurantId: string | null; orders: unknown[] }>("/api/hotel/history"),
  },

  groceryAdmin: {
    getDashboard: () =>
      apiRequest<{
        store: unknown | null;
        stats: { total: number; pending: number; today: number };
      }>("/api/grocery/dashboard"),
    saveStore: (payload: Record<string, unknown>) =>
      apiRequest<{ store: unknown | null }>("/api/grocery/store", { method: "PUT", body: payload }),
    getItems: () => apiRequest<{ storeId: string | null; items: unknown[] }>("/api/grocery/items"),
    createItem: (payload: Record<string, unknown>) =>
      apiRequest<{ item: unknown }>("/api/grocery/items", { method: "POST", body: payload }),
    updateItem: (id: string, payload: Record<string, unknown>) =>
      apiRequest<{ item: unknown }>(`/api/grocery/items/${id}`, { method: "PUT", body: payload }),
    deleteItem: (id: string) =>
      apiRequest<{ ok: true }>(`/api/grocery/items/${id}`, { method: "DELETE" }),
    toggleItem: (id: string, is_available: boolean) =>
      apiRequest<{ item: unknown }>(`/api/grocery/items/${id}/toggle`, {
        method: "POST",
        body: { is_available },
      }),
    getOrders: () =>
      apiRequest<{ storeId: string | null; orders: unknown[] }>("/api/grocery/orders"),
    advanceOrder: (id: string, status: string) =>
      apiRequest<{ order: unknown }>(`/api/grocery/orders/${id}/advance`, {
        method: "POST",
        body: { status },
      }),
    getHistory: () =>
      apiRequest<{ storeId: string | null; orders: unknown[] }>("/api/grocery/history"),
    getAlerts: () =>
      apiRequest<{ lowStock: unknown[]; expiringSoon: unknown[] }>("/api/grocery/alerts"),
  },

  reviews: {
    create: (payload: {
      service_kind: "food" | "grocery" | "ride" | "package";
      service_id: string;
      rating: number;
      comment?: string;
    }) => apiRequest<{ review: unknown }>("/api/reviews", { method: "POST", body: payload }),
    list: (serviceKind: string, serviceId: string) =>
      apiRequest<{ reviews: unknown[] }>(`/api/reviews/${serviceKind}/${serviceId}`),
  },

  delivery: {
    getAvailable: () =>
      apiRequest<{ food: unknown[]; grocery: unknown[] }>("/api/delivery/available"),
    getActive: () => apiRequest<{ food: unknown[]; grocery: unknown[] }>("/api/delivery/active"),
    accept: (kind: "food" | "grocery", id: string) =>
      apiRequest<{ order: unknown }>(`/api/delivery/${kind}/${id}/accept`, { method: "POST" }),
    advance: (kind: "food" | "grocery", id: string, status: string, delivery_pin?: string) =>
      apiRequest<{ order: unknown }>(`/api/delivery/${kind}/${id}/advance`, {
        method: "POST",
        body: { status, delivery_pin },
      }),
    getHistory: () => apiRequest<{ food: unknown[]; grocery: unknown[] }>("/api/delivery/history"),
    getEarnings: () =>
      apiRequest<{ todayEarnings: number; monthEarnings: number; totalDeliveries: number }>(
        "/api/delivery/earnings",
      ),
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
      apiRequest<{ packageDelivery: unknown }>(`/api/rider/packages/${id}/accept`, {
        method: "POST",
      }),
    advance: (
      table: "rides" | "package_deliveries",
      id: string,
      status: string,
      delivery_pin?: string,
    ) =>
      apiRequest<{ job: unknown }>(`/api/rider/${table}/${id}/advance`, {
        method: "POST",
        body: { status, delivery_pin },
      }),
    getEarnings: () =>
      apiRequest<{ todayEarnings: number; monthEarnings: number; totalJobs: number }>(
        "/api/rider/earnings",
      ),
    cancel: (table: "rides" | "package_deliveries", id: string) =>
      apiRequest<{ job: unknown }>(`/api/rider/${table}/${id}/cancel`, { method: "POST" }),
    getHistory: () => apiRequest<{ rides: unknown[]; packages: unknown[] }>("/api/rider/history"),
  },
};
