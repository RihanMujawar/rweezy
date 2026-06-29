import { restRequest, serviceRoleRestRequest } from "../lib/supabase.mjs";
import { HttpError, isMissingTableError } from "../lib/http.mjs";
import { cleanText } from "../lib/request-utils.mjs";
import { logEvent } from "../lib/logger.mjs";
import { env } from "../lib/env.mjs";

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

function normalizeChatKind(kind) {
  return ["ride", "package", "food", "grocery"].includes(kind) ? kind : null;
}

function chatTarget(kind) {
  return {
    ride: { table: "rides", partnerColumn: "rider_id" },
    package: { table: "package_deliveries", partnerColumn: "rider_id" },
    food: { table: "food_orders", partnerColumn: "delivery_boy_id" },
    grocery: { table: "grocery_orders", partnerColumn: "delivery_boy_id" },
  }[kind];
}

function isChatParticipant(userId, row, partnerColumn) {
  return row?.customer_id === userId || row?.[partnerColumn] === userId;
}

async function getChatContext(token, user, kind, serviceId) {
  const normalizedKind = normalizeChatKind(kind);
  if (!normalizedKind) {
    throw new HttpError(400, "Invalid chat type");
  }

  const target = chatTarget(normalizedKind);
  const rows = await restRequest(
    token,
    buildPath(`/${target.table}`, {
      select: `id,customer_id,${target.partnerColumn}`,
      id: `eq.${serviceId}`,
      limit: "1",
    }),
  );
  const row = firstRow(rows);

  if (!row) {
    throw new HttpError(404, "Chat target not found");
  }

  if (isChatParticipant(user.id, row, target.partnerColumn)) {
    return { kind: normalizedKind, row, partnerColumn: target.partnerColumn };
  }

  // Check admin role
  const { getRoles } = await import("../lib/supabase.mjs");
  const roles = await getRoles(token, user.id);
  if (!roles.includes("admin")) {
    throw new HttpError(403, "You do not have access to this chat");
  }

  return { kind: normalizedKind, row, partnerColumn: target.partnerColumn };
}

async function getProfileDisplayName(userId) {
  const rows = await serviceRoleRestRequest(
    buildPath("/profiles", {
      select: "full_name",
      id: `eq.${userId}`,
      limit: "1",
    }),
  );
  return cleanText(firstRow(rows)?.full_name) || "Someone";
}

function trimToken(value) {
  return String(value ?? "").trim();
}

async function getPushTokensForUsers(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const rows = await serviceRoleRestRequest(
    buildPath("/user_push_tokens", {
      select: "token,user_id",
      user_id: `in.(${uniqueIds.join(",")})`,
      order: "updated_at.desc",
      limit: "50",
    }),
  );

  const seen = new Set();
  return (rows ?? [])
    .map((row) => trimToken(row.token))
    .filter((token) => {
      if (!token || seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

async function trySendFcmNotification({ token, title, body, data = {} }) {
  if (!env.fcmServerKey) return { ok: false, skipped: true };
  try {
     const response = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `key=${env.fcmServerKey}`,
      },
      body: JSON.stringify({
        to: token,
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
    return { ok: response.ok };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to send push notification",
    };
  }
}

function chatKindLabel(kind) {
  return (
    {
      ride: "Ride chat",
      package: "Package chat",
      food: "Food order chat",
      grocery: "Grocery order chat",
    }[kind] ?? "Chat"
  );
}

function getChatRecipientUserIds(context, senderId) {
  const { row, partnerColumn } = context;
  const recipients = [];
  if (row.customer_id && row.customer_id !== senderId) {
    recipients.push(row.customer_id);
  }
  const partnerId = row[partnerColumn];
  if (partnerId && partnerId !== senderId) {
    recipients.push(partnerId);
  }
  return recipients;
}

async function notifyChatRecipients({ senderId, context, kind, serviceId, messageBody }) {
  const recipientIds = getChatRecipientUserIds(context, senderId);
  if (recipientIds.length === 0) return;

  const [senderName, tokens] = await Promise.all([
    getProfileDisplayName(senderId),
    getPushTokensForUsers(recipientIds),
  ]);
  if (tokens.length === 0) return;

  const preview =
    messageBody.length > 120 ? `${messageBody.slice(0, 117)}...` : messageBody;
  const title = `${senderName} · ${chatKindLabel(kind)}`;

  await Promise.all(
    tokens.map((token) =>
      trySendFcmNotification({
        token,
        title,
        body: preview,
        data: {
          type: "chat",
          service_kind: kind,
          service_id: serviceId,
          sender_id: senderId,
        },
      }),
    ),
  );
}

export const chatRoutes = [
  {
    method: "GET",
    pattern: /^\/api\/chat\/(ride|package|food|grocery)\/([^/]+)$/,
    handler: async ({ token, user, match }) => {
      const kind = match[1];
      const serviceId = decodeURIComponent(match[2]);
      const context = await getChatContext(token, user, kind, serviceId);

      const messages = await restRequest(
        token,
        buildPath("/chat_messages", {
          select: "id,service_kind,service_id,sender_id,body,created_at",
          service_kind: `eq.${context.kind}`,
          service_id: `eq.${serviceId}`,
          order: "created_at.asc",
          limit: "100",
        }),
      );

      return {
        messages: messages ?? [],
        participant: {
          customer_id: context.row.customer_id,
          partner_id: context.row[context.partnerColumn] ?? null,
        },
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/chat\/(ride|package|food|grocery)\/([^/]+)$/,
    handler: async ({ token, user, match, body }) => {
      const kind = match[1];
      const serviceId = decodeURIComponent(match[2]);
      const context = await getChatContext(token, user, kind, serviceId);

      const messageBody = cleanText(body.message);
      if (!messageBody) {
        throw new HttpError(400, "Message is required");
      }

      if (messageBody.length > 1000) {
        throw new HttpError(400, "Message is too long");
      }

      const rows = await restRequest(token, buildPath("/chat_messages", { select: "*" }), {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          service_kind: kind,
          service_id: serviceId,
          sender_id: user.id,
          body: messageBody,
        },
      });

      const saved = firstRow(rows);

      void notifyChatRecipients({
        senderId: user.id,
        context,
        kind,
        serviceId,
        messageBody,
      }).catch((error) => {
        logEvent("warn", "chat_push_notify_failed", {
          serviceId,
          kind,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return { message: saved };
    },
  },
];
