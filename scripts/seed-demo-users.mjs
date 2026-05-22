import { env } from "../backend/lib/env.mjs";
import { serviceRoleRestRequest } from "../backend/lib/supabase.mjs";

const password = process.env.DEMO_PASSWORD || "Demo123456";

const demoUsers = [
  { email: "demo.customer@zoomly.test", fullName: "Demo Customer", phone: "+919000000001", role: "customer" },
  { email: "demo.rider@zoomly.test", fullName: "Demo Rider", phone: "+919000000002", role: "rider" },
  {
    email: "demo.delivery@zoomly.test",
    fullName: "Demo Delivery Partner",
    phone: "+919000000003",
    role: "delivery_boy",
  },
  {
    email: "demo.restaurant@zoomly.test",
    fullName: "Demo Restaurant Manager",
    phone: "+919000000004",
    role: "hotel_manager",
  },
  {
    email: "demo.grocery@zoomly.test",
    fullName: "Demo Grocery Manager",
    phone: "+919000000005",
    role: "grocery_manager",
  },
  { email: "demo.admin@zoomly.test", fullName: "Demo Admin", phone: "+919000000006", role: "admin" },
];

async function adminAuth(path, options = {}) {
  if (!env.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for demo seeding");
  }

  const response = await fetch(`${env.supabaseUrl}/auth/v1/admin${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: env.supabaseServiceRoleKey,
      Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Auth admin request failed: ${response.status}`);
  }
  return payload;
}

async function findUserByEmail(email) {
  for (let page = 1; page <= 10; page += 1) {
    const payload = await adminAuth(`/users?page=${page}&per_page=100`);
    const users = Array.isArray(payload?.users) ? payload.users : [];
    const found = users.find((user) => user.email === email);
    if (found) return found;
    if (users.length < 100) return null;
  }
  return null;
}

async function ensureUser(demoUser) {
  const existing = await findUserByEmail(demoUser.email);
  if (existing) return existing;

  return adminAuth("/users", {
    method: "POST",
    body: {
      email: demoUser.email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: demoUser.fullName,
        phone: demoUser.phone,
        role: demoUser.role,
      },
    },
  });
}

for (const demoUser of demoUsers) {
  const user = await ensureUser(demoUser);
  const userId = user.id || user.user?.id;
  if (!userId) throw new Error(`No user id returned for ${demoUser.email}`);

  await serviceRoleRestRequest("/profiles?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: {
      id: userId,
      full_name: demoUser.fullName,
      phone: demoUser.phone,
    },
  });

  await serviceRoleRestRequest("/user_roles?on_conflict=user_id,role", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: {
      user_id: userId,
      role: demoUser.role,
    },
  });

  console.log(`${demoUser.email} / ${password} -> ${demoUser.role}`);
}
