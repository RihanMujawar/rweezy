import express from "express";
import cookieParser from "cookie-parser";
import amqp from "amqplib";
import { prisma } from "../../shared/lib/prisma.mjs";
import { HttpError } from "../../shared/lib/http.mjs";
import { authenticate } from "../../shared/lib/auth.mjs";
import { env } from "../../shared/lib/env.mjs";

const app = express();
app.use(express.json());
app.use(cookieParser());

app.get("/api/chat/:kind/:id", authenticate, async (req, res, next) => {
  try {
    const { kind, id } = req.params;
    const messages = await prisma.chatMessage.findMany({
        where: { serviceKind: kind, serviceId: id },
        orderBy: { createdAt: 'asc' }
    });

    // We should also find who the participants are based on the service kind and id
    let participant = { customer_id: "", partner_id: null };
    if (kind === 'food') {
        const order = await prisma.foodOrder.findUnique({ where: { id } });
        if (order) participant = { customer_id: order.customerId, partner_id: order.deliveryBoyId };
    } else if (kind === 'grocery') {
        const order = await prisma.groceryOrder.findUnique({ where: { id } });
        if (order) participant = { customer_id: order.customerId, partner_id: order.deliveryBoyId };
    } else if (kind === 'ride') {
        const ride = await prisma.ride.findUnique({ where: { id } });
        if (ride) participant = { customer_id: ride.customerId, partner_id: ride.riderId };
    } else if (kind === 'package') {
        const pkg = await prisma.packageDelivery.findUnique({ where: { id } });
        if (pkg) participant = { customer_id: pkg.customerId, partner_id: pkg.riderId };
    }

    res.json({
        messages,
        participant
    });
  } catch (error) { next(error); }
});

app.post("/api/chat/:kind/:id", authenticate, async (req, res, next) => {
  try {
    const { kind, id } = req.params;
    const { message } = req.body;

    const saved = await prisma.chatMessage.create({
        data: {
            serviceKind: kind,
            serviceId: id,
            senderId: req.user.id,
            body: message
        }
    });

    try {
        const conn = await amqp.connect(env.rabbitMqUrl || "amqp://localhost:5672");
        const channel = await conn.createChannel();
        const queue = "notifications";
        await channel.assertQueue(queue, { durable: true });
        channel.sendToQueue(queue, Buffer.from(JSON.stringify({
            type: "chat",
            kind,
            serviceId: id,
            senderId: req.user.id,
            messageBody: message
        })));
    } catch (e) {
        console.warn("RabbitMQ notification failed:", e.message);
    }

    res.json({ message: saved });
  } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = process.env.PORT || 3006;
app.listen(PORT, () => console.log(`Chat Service running on port ${PORT}`));
