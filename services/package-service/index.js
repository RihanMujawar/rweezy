import express from "express";
import cookieParser from "cookie-parser";
import admin from "firebase-admin";
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
const fb = admin.apps?.length > 0 ? admin.database() : null;

const app = express();
app.use(express.json());
app.use(cookieParser());

app.post("/api/packages", authenticate, async (req, res, next) => {
    try {
        const { pickup_address, pickup_lat, pickup_lng, drop_address, drop_lat, drop_lng, package_size, receiver_name, receiver_phone, notes, fare_estimate, payment_method } = req.body;

        const pkg = await prisma.packageDelivery.create({
            data: {
                customerId: req.user.id,
                pickupAddress: pickup_address,
                pickupLat: pickup_lat,
                pickupLng: pickup_lng,
                dropAddress: drop_address,
                dropLat: drop_lat,
                dropLng: drop_lng,
                packageSize: package_size || 'small',
                receiverName: receiver_name,
                receiverPhone: receiver_phone,
                notes: notes,
                fareEstimate: fare_estimate,
                paymentMethod: payment_method || 'cash',
                status: 'requested'
            }
        });

        if (fb) {
            await fb.ref(`packages/${pkg.id}`).set({
                status: pkg.status,
                pickup: { lat: pkg.pickupLat, lng: pkg.pickupLng },
                drop: { lat: pkg.dropLat, lng: pkg.dropLng }
            });
        }
        res.json({ packageDelivery: pkg });
    } catch (error) { next(error); }
});

app.get("/api/track/package/:id", authenticate, async (req, res, next) => {
    try {
        const pkg = await prisma.packageDelivery.findUnique({
            where: { id: req.params.id }
        });
        res.json({ row: pkg });
    } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => console.log(`Package Service running on port ${PORT}`));
