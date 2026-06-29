import { restRequest, serviceRoleRestRequest } from "../lib/supabase.mjs";
import { HttpError } from "../lib/http.mjs";
import { reviewSchema } from "../lib/validation.mjs";
import {
  sanitizeComment,
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

export const reviewRoutes = [
  {
    method: "POST",
    pattern: /^\/api\/reviews$/,
    handler: async ({ token, user, body }) => {
      const validated = reviewSchema.parse(body);

      const rows = await restRequest(token, buildPath("/order_reviews", { select: "*" }), {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          user_id: user.id,
          service_kind: validated.service_kind,
          service_id: validated.service_id,
          rating: validated.rating,
          comment: sanitizeComment(validated.comment),
        },
      });

      return { review: firstRow(rows) };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/reviews\/([^/]+)\/([^/]+)$/,
    handler: async ({ token, match }) => {
      const serviceKind = match[1];
      const serviceId = decodeURIComponent(match[2]);
      const rows = await restRequest(
        token,
        buildPath("/order_reviews", {
          select: "id,rating,comment,created_at,user_id",
          service_kind: `eq.${serviceKind}`,
          service_id: `eq.${serviceId}`,
          order: "created_at.desc",
          limit: "20",
        }),
      );
      return { reviews: rows ?? [] };
    },
  },
];
