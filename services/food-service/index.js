import express from "express";
import cookieParser from "cookie-parser";
import { restRequest } from "../../shared/lib/supabase.mjs";
import { HttpError } from "../../shared/lib/http.mjs";
import { authenticate } from "../../shared/lib/auth.mjs";

const app = express();
app.use(express.json());
app.use(cookieParser());

// --- Food Routes ---

app.get("/api/catalog/restaurants", authenticate, async (req, res, next) => {
  try {
    const restaurants = await restRequest(req.token, "/restaurants?select=*&order=created_at.desc");
    res.json({ restaurants: restaurants ?? [] });
  } catch (error) { next(error); }
});

app.get("/api/catalog/restaurants/:id", authenticate, async (req, res, next) => {
    try {
        const [restaurantRows, itemRows] = await Promise.all([
            restRequest(req.token, "/restaurants?id=eq." + req.params.id),
            restRequest(req.token, "/menu_items?restaurant_id=eq." + req.params.id + "&is_available=eq.true")
        ]);
        res.json({ restaurant: restaurantRows?.[0] || null, items: itemRows ?? [] });
    } catch (error) { next(error); }
});

app.get("/api/catalog/items/food", authenticate, async (req, res, next) => {
    try {
        const items = await restRequest(req.token, "/menu_items?select=*,restaurants(name)&is_available=eq.true&limit=12");
        res.json({ items: items ?? [] });
    } catch (error) { next(error); }
});

app.post("/api/orders/food", authenticate, async (req, res, next) => {
    try {
        // Full order placement logic from server.mjs
        const rows = await restRequest(req.token, "/food_orders", { method: "POST", body: { ...req.body, customer_id: req.user.id } });
        res.json({ order: rows?.[0] });
    } catch (error) { next(error); }
});

// Hotel Manager Routes
app.get("/api/hotel/dashboard", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/restaurants?manager_id=eq." + req.user.id);
        const restaurant = rows?.[0];
        if (!restaurant) return res.json({ restaurant: null, stats: { total: 0, pending: 0, today: 0 } });
        const orders = await restRequest(req.token, "/food_orders?restaurant_id=eq." + restaurant.id);
        res.json({ restaurant, stats: { total: orders?.length ?? 0, pending: 0, today: 0 } });
    } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = 3002;
app.listen(PORT, () => console.log(`Food Service running on port ${PORT}`));
