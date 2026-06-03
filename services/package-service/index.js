import express from "express";
import cookieParser from "cookie-parser";
import admin from "firebase-admin";
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

const app = express();
app.use(express.json());
app.use(cookieParser());

app.post("/api/packages", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/package_deliveries", { method: "POST", body: { ...req.body, customer_id: req.user.id } });
        const pkg = rows?.[0];
        if (pkg) {
            await fb.ref(`packages/${pkg.id}`).set({
                status: pkg.status,
                pickup: { lat: pkg.pickup_lat, lng: pkg.pickup_lng },
                drop: { lat: pkg.drop_lat, lng: pkg.drop_lng }
            });
        }
        res.json({ packageDelivery: pkg });
    } catch (error) { next(error); }
});

app.get("/api/track/package/:id", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/package_deliveries?id=eq." + req.params.id);
        const pkg = rows?.[0];
        res.json({ row: pkg });
    } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = 3005;
app.listen(PORT, () => console.log(`Package Service running on port ${PORT}`));
