import amqp from "amqplib";
import fetch from "node-fetch";
import { prisma } from "../../shared/lib/prisma.mjs";
import { env } from "../../shared/lib/env.mjs";

async function getPushTokensForUsers(userIds) {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if (uniqueIds.length === 0) return [];

    const tokens = await prisma.userPushToken.findMany({
        where: { userId: { in: uniqueIds } },
        select: { token: true },
        orderBy: { updatedAt: 'desc' },
        take: 50
    });

    return [...new Set(tokens.map(r => r.token).filter(Boolean))];
}

async function sendFcmNotification({ token, title, body, data = {} }) {
  if (!env.fcmServerKey) return;
  try {
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
  } catch (e) {
      console.warn("FCM Send failed:", e.message);
  }
}

async function start() {
    try {
        const conn = await amqp.connect(env.rabbitMqUrl || "amqp://localhost:5672");
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
                        // Determine recipients for the chat message
                        let recipientIds = [];
                        if (task.kind === 'food') {
                            const order = await prisma.foodOrder.findUnique({ where: { id: task.serviceId } });
                            if (order) {
                                if (order.customerId !== task.senderId) recipientIds.push(order.customerId);
                                if (order.deliveryBoyId && order.deliveryBoyId !== task.senderId) recipientIds.push(order.deliveryBoyId);
                            }
                        } else if (task.kind === 'grocery') {
                            const order = await prisma.groceryOrder.findUnique({ where: { id: task.serviceId } });
                            if (order) {
                                if (order.customerId !== task.senderId) recipientIds.push(order.customerId);
                                if (order.deliveryBoyId && order.deliveryBoyId !== task.senderId) recipientIds.push(order.deliveryBoyId);
                            }
                        } else if (task.kind === 'ride') {
                            const ride = await prisma.ride.findUnique({ where: { id: task.serviceId } });
                            if (ride) {
                                if (ride.customerId !== task.senderId) recipientIds.push(ride.customerId);
                                if (ride.riderId && ride.riderId !== task.senderId) recipientIds.push(ride.riderId);
                            }
                        } else if (task.kind === 'package') {
                            const pkg = await prisma.packageDelivery.findUnique({ where: { id: task.serviceId } });
                            if (pkg) {
                                if (pkg.customerId !== task.senderId) recipientIds.push(pkg.customerId);
                                if (pkg.riderId && pkg.riderId !== task.senderId) recipientIds.push(pkg.riderId);
                            }
                        }

                        if (recipientIds.length > 0) {
                            const tokens = await getPushTokensForUsers(recipientIds);
                            for (const token of tokens) {
                                await sendFcmNotification({
                                    token,
                                    title: "New Message",
                                    body: task.messageBody,
                                    data: { type: "chat", service_id: task.serviceId, service_kind: task.kind }
                                });
                            }
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
