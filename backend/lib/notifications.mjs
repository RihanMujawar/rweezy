import { prisma } from "./prisma.mjs";
import { env } from "./env.mjs";
import { logEvent } from "./logger.mjs";
import { cleanText } from "./request-utils.mjs";
import { isBaileysConfigured, sendWhatsAppText } from "./baileys.mjs";

async function sendWhatsAppMessage(phone, text) {
  if (!isBaileysConfigured()) return { ok: false, error: "Baileys not configured" };

  try {
    await sendWhatsAppText(phone, text);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function sendFcmNotification({ token, title, body, data = {} }) {
  if (!env.fcmServerKey) return { ok: false, error: "FCM not configured" };

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
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getPushTokensForUsers(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  try {
    const tokens = await prisma.userPushToken.findMany({
      where: { user_id: { in: uniqueIds } },
      orderBy: { updated_at: "desc" },
      take: 50,
      select: { token: true }
    });
    const seen = new Set();
    return (tokens ?? [])
      .map((row) => String(row.token ?? "").trim())
      .filter((token) => {
        if (!token || seen.has(token)) return false;
        seen.add(token);
        return true;
      });
  } catch (error) {
    console.warn("Failed to fetch push tokens:", error.message);
    return [];
  }
}

async function getPhonesForUsers(userIds) {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  try {
    const profiles = await prisma.profile.findMany({
      where: { id: { in: uniqueIds } },
      select: { phone: true }
    });
    return (profiles ?? [])
      .map((row) => String(row.phone ?? "").trim())
      .filter(Boolean);
  } catch (error) {
    console.warn("Failed to fetch phones:", error.message);
    return [];
  }
}

export async function sendNotification(userIds, { title, body, data = {} }) {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  if (ids.length === 0) return;

  const [tokens, phones] = await Promise.all([
    getPushTokensForUsers(ids),
    getPhonesForUsers(ids),
  ]);

  const results = await Promise.allSettled([
    ...tokens.map((token) => sendFcmNotification({ token, title, body, data })),
    ...phones.map((phone) => sendWhatsAppMessage(phone, `${title}\n\n${body}`)),
  ]);

  logEvent("info", "notifications_sent", {
    userIdCount: ids.length,
    fcmCount: tokens.length,
    whatsappCount: phones.length,
    success: results.filter((r) => r.status === "fulfilled" && r.value.ok).length,
    failed: results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok)).length,
  });
}

export async function notifyUsersWithRole(role, notification) {
  try {
    const userRoles = await prisma.userRole.findMany({
      where: { role },
      select: { user_id: true }
    });
    const userIds = (userRoles ?? []).map((row) => row.user_id);
    if (userIds.length > 0) {
      await sendNotification(userIds, notification);
    }
  } catch (error) {
    logEvent("error", "role_notification_failed", { role, error: error.message });
  }
}
