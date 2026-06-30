import { restRequest, serviceRoleRestRequest } from "../lib/supabase.mjs";
import { HttpError } from "../lib/http.mjs";
import { cleanText } from "../lib/request-utils.mjs";
import { addressSchema, profileUpdateSchema } from "../lib/validation.mjs";

function firstRow(rows) {
  return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
}

function normalizeBusinessRole(role) {
  return ["hotel_manager", "grocery_manager", "delivery_boy", "rider"].includes(role) ? role : null;
}

export const profileRoutes = [
  {
    method: "GET",
    pattern: /^\/api\/profile$/,
    handler: async ({ token, user }) => {
      const rows = await restRequest(
        token,
        `/profiles?select=*&id=eq.${user.id}`,
      );

      return { profile: firstRow(rows) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/profile\/addresses$/,
    handler: async ({ token, user }) => {
      const rows = await restRequest(
        token,
        `/saved_addresses?select=*&user_id=eq.${user.id}&order=is_default.desc,created_at.desc`,
      );

      return { addresses: rows ?? [] };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/profile\/addresses$/,
    handler: async ({ token, user, body }) => {
      const validated = addressSchema.parse(body);
      const rows = await restRequest(token, `/saved_addresses?select=*`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          user_id: user.id,
          label: validated.label || "Saved address",
          address: validated.address,
          lat: validated.lat,
          lng: validated.lng,
          is_default: !!validated.is_default,
        },
      });

      return { address: firstRow(rows) };
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/profile\/addresses\/([^/]+)$/,
    handler: async ({ token, user, match }) => {
      const id = decodeURIComponent(match[1]);
      await restRequest(token, `/saved_addresses?id=eq.${id}&user_id=eq.${user.id}`, {
        method: "DELETE",
      });
      return { ok: true };
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/profile$/,
    handler: async ({ token, user, body }) => {
      const validated = profileUpdateSchema.parse(body);
      const rows = await restRequest(
        token,
        `/profiles?id=eq.${user.id}&select=*`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: {
            full_name: validated.full_name,
            phone: validated.phone,
          },
        },
      );

      return { profile: firstRow(rows) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/role-requests$/,
    handler: async ({ token, user }) => {
      const rows = await restRequest(
        token,
        `/role_requests?select=*&user_id=eq.${user.id}&order=created_at.desc`,
      );

      return { requests: rows ?? [] };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/role-requests$/,
    handler: async ({ token, user, body }) => {
      const requestedRole = normalizeBusinessRole(body.requested_role);
      if (!requestedRole) throw new HttpError(400, "Choose a valid role to request");

      const rows = await restRequest(token, `/role_requests?select=*`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          user_id: user.id,
          requested_role: requestedRole,
          business_name: cleanText(body.business_name) || null,
          message: cleanText(body.message) || null,
        },
      });

      const request = firstRow(rows);
      if (request) {
        // Notify Admins
        void (async () => {
          try {
            const { notifyUsersWithRole } = await import("../lib/notifications.mjs");
            const roleLabel = requestedRole.replace(/_/g, " ");
            await notifyUsersWithRole("admin", {
              title: "New Role Request",
              body: `${user.user_metadata?.full_name || "A user"} has requested the ${roleLabel} role.`,
              data: { type: "new_role_request", user_id: user.id, role: requestedRole },
            });
          } catch (error) {
            console.warn("Failed to send admin role request notification:", error.message);
          }
        })();
      }

      return { request };
    },
  },
];
