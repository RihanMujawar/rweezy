import { restRequest, serviceRoleRestRequest } from "../lib/supabase.mjs";
import { HttpError } from "../lib/http.mjs";
import { cleanText } from "../lib/request-utils.mjs";
import { logEvent } from "../lib/logger.mjs";
import { env } from "../lib/env.mjs";

function firstRow(rows) {
  return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
}

function trimToken(value) {
  return String(value ?? "").trim();
}

async function sendFcmNotification({ token, title, body, data = {} }) {
  const { cleanText } = await import("../lib/request-utils.mjs");
  if (!env.fcmServerKey) {
    throw new HttpError(
      500,
      "Missing FCM_SERVER_KEY. Add your Firebase server key to backend .env and restart the server.",
    );
  }

  const targetToken = trimToken(token);
  if (!targetToken) throw new HttpError(400, "Push token is required");

  const response = await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `key=${env.fcmServerKey}`,
    },
    body: JSON.stringify({
      to: targetToken,
      priority: "high",
      notification: {
        title: cleanText(title) || "Rweezy",
        body: cleanText(body) || "You have a new update.",
      },
      data: Object.fromEntries(
        Object.entries(data ?? {}).map(([key, value]) => [String(key), String(value ?? "")]),
      ),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, "Failed to deliver push notification");

  if (payload?.failure > 0) {
    const message = payload?.results?.[0]?.error;
    throw new HttpError(400, message ? `FCM rejected token: ${message}` : "FCM rejected notification");
  }

  return payload;
}

export const notificationRoutes = [
  {
    method: "POST",
    pattern: /^\/api\/notifications\/token$/,
    handler: async ({ user, body }) => {
      const token = trimToken(body.token);
      if (!token) throw new HttpError(400, "token is required");

      const platform = cleanText(body.platform) || "web";
      const deviceLabel = cleanText(body.device_label || body.user_agent || "");

      const rows = await serviceRoleRestRequest(
        `/user_push_tokens?on_conflict=token`,
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: {
            user_id: user.id,
            token,
            platform,
            device_label: deviceLabel || null,
            updated_at: new Date().toISOString(),
          },
        },
      );

      return { pushToken: firstRow(rows) };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/admin\/notifications\/test$/,
    handler: async ({ token, user, body }) => {
      const { getRoles } = await import("../lib/supabase.mjs");
      const roles = await getRoles(token, user.id);

      if (!roles.includes("admin")) {
        throw new HttpError(403, "Only admin users can send test notifications");
      }

      const explicitToken = trimToken(body.token);
      const targetUserId = cleanText(body.user_id);

      let targetTokens = explicitToken ? [explicitToken] : [];
      if (!explicitToken && targetUserId) {
        const rows = await serviceRoleRestRequest(
          `/user_push_tokens?select=token&user_id=eq.${targetUserId}&order=updated_at.desc&limit=5`,
        );
        targetTokens = (rows ?? []).map((row) => trimToken(row.token)).filter(Boolean);
      }

      if (targetTokens.length === 0) {
        throw new HttpError(400, "Provide token or user_id with at least one saved token");
      }

      const title = cleanText(body.title) || "Test notification";
      const message = cleanText(body.body) || "This is a test push from Rweezy backend.";
      const data = body.data && typeof body.data === "object" ? body.data : {};

      const results = [];
      for (const fcmToken of targetTokens) {
        try {
          const result = await sendFcmNotification({
            token: fcmToken,
            title,
            body: message,
            data,
          });
          results.push({ token: fcmToken, ok: true, result });
        } catch (error) {
          results.push({
            token: fcmToken,
            ok: false,
            error: error instanceof Error ? error.message : "Failed",
          });
        }
      }

      return {
        sent: results.filter((item) => item.ok).length,
        failed: results.filter((item) => !item.ok).length,
        results,
      };
    },
  },
];
