import amqp from "amqplib";
import fetch from "node-fetch";
import { env } from "../../shared/lib/env.mjs";
import { serviceRoleRestRequest } from "../../shared/lib/supabase.mjs";

async function getPushTokensForUsers(userIds) {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    const rows = await serviceRoleRestRequest("/user_push_tokens?select=token&user_id=in.(" + uniqueIds.join(",") + ")&order=updated_at.desc&limit=50");
    return [...new Set((rows ?? []).map(r => r.token).filter(Boolean))];
}

async function sendFcmNotification({ token, title, body, data = {} }) {
  if (!env.fcmServerKey) return;
  await fetch("https://fcm.googleapis.com/fcm/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `key=${env.fcmServerKey}`,
    },
    body: JSON.stringify({
      to: token,
      priority: "high",
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [String(k), String(v)])),
    }),
  });
}

async function start() {
    try {
        const conn = await amqp.connect(env.rabbitMqUrl || "amqp://rabbitmq:5672");
        const channel = await conn.createChannel();
        const queue = "notifications";

        await channel.assertQueue(queue, { durable: true });
        console.log(`Notification Service waiting for messages in ${queue}`);

        channel.consume(queue, async (msg) => {
            if (msg !== null) {
                try {
                    const task = JSON.parse(msg.content.toString());
                    console.log("Processing notification task:", task);

                    if (task.type === "chat") {
                        const tokens = await getPushTokensForUsers([task.recipientId]); // This would need the actual recipientId
                        for (const token of tokens) {
                            await sendFcmNotification({
                                token,
                                title: "New Message",
                                body: task.messageBody,
                                data: { type: "chat", service_id: task.serviceId, service_kind: task.kind }
                            });
                        }
                    }
                } catch (e) {
                    console.error("Task processing error:", e);
                } finally {
                    channel.ack(msg);
                }
            }
        });
    } catch (error) {
        console.error("Notification Service error:", error);
        setTimeout(start, 5000);
    }
}

start();
