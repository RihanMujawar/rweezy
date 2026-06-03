import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import amqp from "amqplib";
import { HttpError } from "../../shared/lib/http.mjs";
import { authenticate } from "../../shared/lib/auth.mjs";
import { env } from "../../shared/lib/env.mjs";

const messageSchema = new mongoose.Schema({
  service_kind: String,
  service_id: String,
  sender_id: String,
  body: String,
  created_at: { type: Date, default: Date.now }
});
const Message = mongoose.model("Message", messageSchema);

if (env.mongoUri) {
    mongoose.connect(env.mongoUri);
}

const app = express();
app.use(express.json());
app.use(cookieParser());

app.get("/api/chat/:kind/:id", authenticate, async (req, res, next) => {
  try {
    const { kind, id } = req.params;
    const messages = await Message.find({ service_kind: kind, service_id: id }).sort({ created_at: 1 });
    res.json({
        messages,
        participant: { customer_id: "", partner_id: null } // Simplified for now
    });
  } catch (error) { next(error); }
});

app.post("/api/chat/:kind/:id", authenticate, async (req, res, next) => {
  try {
    const { kind, id } = req.params;
    const { message } = req.body;
    const saved = await Message.create({
      service_kind: kind,
      service_id: id,
      sender_id: req.user.id,
      body: message
    });

    const conn = await amqp.connect(env.rabbitMqUrl || "amqp://rabbitmq:5672");
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

    res.json({ message: saved });
  } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = 3006;
app.listen(PORT, () => console.log(`Chat Service running on port ${PORT}`));
