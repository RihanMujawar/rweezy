import express from "express";
import cookieParser from "cookie-parser";
import admin from "firebase-admin";
import Redis from "ioredis";
import { restRequest } from "../../shared/lib/supabase.mjs";
import { HttpError } from "../../shared/lib/http.mjs";
import { authenticate } from "../../shared/lib/auth.mjs";
import { env } from "../../shared/lib/env.mjs";

if (env.firebaseConfig) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(env.firebaseConfig)),
        databaseURL: env.firebaseDatabaseUrl
    });
}
const fb = admin.database();
const redis = new Redis(env.redisUrl || "redis://redis:6379");

const app = express();
app.use(express.json());
app.use(cookieParser());

app.post("/api/rides", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/rides", { method: "POST", body: { ...req.body, customer_id: req.user.id } });
        const ride = rows?.[0];
        if (ride) {
            await fb.ref(`rides/${ride.id}`).set({
                status: ride.status,
                pickup: { lat: ride.pickup_lat, lng: ride.pickup_lng },
                drop: { lat: ride.drop_lat, lng: ride.drop_lng }
            });
            // Cache ride data in Redis for quick access
            await redis.set(`ride:${ride.id}`, JSON.stringify(ride), "EX", 3600);
        }
        res.json({ ride });
    } catch (error) { next(error); }
});

app.get("/api/track/ride/:id", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/rides?id=eq." + req.params.id);
        const ride = rows?.[0];
        // Combine Supabase data with Firebase real-time data if needed
        res.json({ row: ride });
    } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = 3004;
app.listen(PORT, () => console.log(`Ride Service running on port ${PORT}`));
