import express from "express";
import cookieParser from "cookie-parser";
import admin from "firebase-admin";
import Redis from "ioredis";
import { prisma } from "../../shared/lib/prisma.mjs";
import { HttpError } from "../../shared/lib/http.mjs";
import { authenticate } from "../../shared/lib/auth.mjs";
import { env } from "../../shared/lib/env.mjs";

if (env.firebaseConfig) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert(JSON.parse(env.firebaseConfig)),
            databaseURL: env.firebaseDatabaseUrl
        });
    } catch (e) {
        console.warn("Firebase initialization failed:", e.message);
    }
}
const fb = admin.apps.length > 0 ? admin.database() : null;
const redis = new Redis(env.redisUrl || "redis://localhost:6379");

const app = express();
app.use(express.json());
app.use(cookieParser());

app.post("/api/rides", authenticate, async (req, res, next) => {
    try {
        const { pickup_address, pickup_lat, pickup_lng, drop_address, drop_lat, drop_lng, fare_estimate, notes, vehicle_type, payment_method } = req.body;

        const ride = await prisma.ride.create({
            data: {
                customerId: req.user.id,
                pickupAddress: pickup_address,
                pickupLat: pickup_lat,
                pickupLng: pickup_lng,
                dropAddress: drop_address,
                dropLat: drop_lat,
                dropLng: drop_lng,
                fareEstimate: fare_estimate,
                notes: notes,
                vehicleType: vehicle_type,
                paymentMethod: payment_method || 'cash',
                status: 'requested'
            }
        });

        if (fb) {
            await fb.ref(`rides/${ride.id}`).set({
                status: ride.status,
                pickup: { lat: ride.pickupLat, lng: ride.pickupLng },
                drop: { lat: ride.dropLat, lng: ride.dropLng }
            });
        }

        await redis.set(`ride:${ride.id}`, JSON.stringify(ride), "EX", 3600);

        res.json({ ride });
    } catch (error) { next(error); }
});

app.get("/api/track/ride/:id", authenticate, async (req, res, next) => {
    try {
        const ride = await prisma.ride.findUnique({
            where: { id: req.params.id }
        });
        res.json({ row: ride });
    } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => console.log(`Ride Service running on port ${PORT}`));
