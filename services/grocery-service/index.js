import express from "express";
import cookieParser from "cookie-parser";
import { restRequest } from "../../shared/lib/supabase.mjs";
import { HttpError } from "../../shared/lib/http.mjs";
import { authenticate } from "../../shared/lib/auth.mjs";

const app = express();
app.use(express.json());
app.use(cookieParser());

// --- Grocery Routes ---

app.get("/api/catalog/stores", authenticate, async (req, res, next) => {
  try {
    const stores = await restRequest(req.token, "/grocery_stores?select=*&order=created_at.desc");
    res.json({ stores: stores ?? [] });
  } catch (error) { next(error); }
});

app.get("/api/catalog/stores/:id", authenticate, async (req, res, next) => {
    try {
        const [storeRows, itemRows] = await Promise.all([
            restRequest(req.token, "/grocery_stores?id=eq." + req.params.id),
            restRequest(req.token, "/grocery_items?store_id=eq." + req.params.id + "&is_available=eq.true")
        ]);
        res.json({ store: storeRows?.[0] || null, items: itemRows ?? [] });
    } catch (error) { next(error); }
});

app.get("/api/catalog/items/grocery", authenticate, async (req, res, next) => {
    try {
        const items = await restRequest(req.token, "/grocery_items?select=*,grocery_stores(name)&is_available=eq.true&limit=12");
        res.json({ items: items ?? [] });
    } catch (error) { next(error); }
});

app.post("/api/orders/grocery", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/grocery_orders", { method: "POST", body: { ...req.body, customer_id: req.user.id } });
        res.json({ order: rows?.[0] });
    } catch (error) { next(error); }
});

app.get("/api/grocery/dashboard", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/grocery_stores?manager_id=eq." + req.user.id);
        const store = rows?.[0];
        if (!store) return res.json({ store: null, stats: { total: 0, pending: 0, today: 0 } });
        const orders = await restRequest(req.token, "/grocery_orders?store_id=eq." + store.id);
        res.json({ store, stats: { total: orders?.length ?? 0, pending: 0, today: 0 } });
    } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = 3003;
app.listen(PORT, () => console.log(`Grocery Service running on port ${PORT}`));
