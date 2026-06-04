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
        const { store_id, items, delivery_address, delivery_lat, delivery_lng, notes, payment_method } = req.body;

        const [storeRows, platformSettings] = await Promise.all([
            restRequest(req.token, `/grocery_stores?id=eq.${store_id}`),
            restRequest(req.token, `/platform_settings?key=eq.fees`)
        ]);
        const store = storeRows?.[0];
        if (!store) throw new HttpError(404, "Store not found");
        const platformFees = platformSettings?.[0]?.value || { flat_platform_fee: 10 };

        const itemIds = items.map(i => i.grocery_item_id);
        const groceryItems = await restRequest(req.token, `/grocery_items?id=in.(${itemIds.join(",")})`);

        let subtotal = 0;
        const orderItems = items.map(item => {
            const gi = groceryItems.find(m => m.id === item.grocery_item_id);
            if (!gi) throw new HttpError(400, `Item ${item.grocery_item_id} not found`);
            const price = Number(gi.price);
            subtotal += price * item.quantity;
            return {
                grocery_item_id: gi.id,
                name: gi.name,
                price: price,
                quantity: item.quantity
            };
        });

        let deliveryFee = subtotal >= Number(store.free_delivery_threshold) ? 0 : Number(store.delivery_fee);
        let packagingFee = Number(store.packaging_fee);
        let rainFee = store.is_raining ? Number(store.rain_fee) : 0;
        let platformFee = Number(platformFees.flat_platform_fee || 0);

        let discount = 0;
        if (store.discount_pct > 0) discount += subtotal * (Number(store.discount_pct) / 100);
        if (store.discount_flat > 0) discount += Number(store.discount_flat);

        if (store.is_bogo_active) {
            items.forEach(item => {
                if (item.quantity >= 2) {
                    const gi = groceryItems.find(m => m.id === item.grocery_item_id);
                    const freeUnits = Math.floor(item.quantity / 2);
                    discount += Number(gi.price) * freeUnits;
                }
            });
        }

        let serviceTax = (subtotal - discount) * (Number(store.service_tax_pct) / 100);
        const total = subtotal + deliveryFee + packagingFee + rainFee + platformFee + serviceTax - discount;

        const orderData = {
            customer_id: req.user.id,
            store_id,
            subtotal,
            delivery_fee_applied: deliveryFee,
            packaging_fee_applied: packagingFee,
            rain_fee_applied: rainFee,
            platform_fee_applied: platformFee,
            service_tax_applied: serviceTax,
            discount_amount: discount,
            total,
            delivery_address,
            delivery_lat,
            delivery_lng,
            notes,
            payment_method,
            status: 'pending'
        };

        const [order] = await restRequest(req.token, "/grocery_orders", {
            method: "POST",
            body: orderData,
            headers: { "Prefer": "return=representation" }
        });

        await restRequest(req.token, "/grocery_order_items", {
            method: "POST",
            body: orderItems.map(oi => ({ ...oi, order_id: order.id }))
        });

        res.json({ order });
    } catch (error) { next(error); }
});

app.get("/api/grocery/dashboard", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/grocery_stores?manager_id=eq." + req.user.id);
        const store = rows?.[0];
        if (!store) return res.json({ store: null, stats: { total: 0, pending: 0, today: 0 } });
        const orders = await restRequest(req.token, "/grocery_orders?store_id=eq." + store.id + "&order=created_at.desc");
        res.json({ store, stats: { total: orders?.length ?? 0, pending: orders?.filter(o => o.status === 'pending').length ?? 0, today: 0 }, orders });
    } catch (error) { next(error); }
});

app.patch("/api/grocery/settings", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/grocery_stores?manager_id=eq." + req.user.id);
        const store = rows?.[0];
        if (!store) throw new HttpError(404, "Store not found");

        await restRequest(req.token, `/grocery_stores?id=eq.${store.id}`, {
            method: "PATCH",
            body: req.body
        });
        res.json({ success: true });
    } catch (error) { next(error); }
});

app.get("/api/grocery/delivery-partners", authenticate, async (req, res, next) => {
    try {
        const [partners, activeOrders] = await Promise.all([
            restRequest(req.token, "/user_roles?role=eq.delivery_boy&select=user_id,profiles(full_name,phone)"),
            restRequest(req.token, "/grocery_orders?status=in.(accepted,preparing,ready,picked_up)&select=delivery_boy_id,status")
        ]);

        const partnerList = partners.map(p => {
            const active = activeOrders?.filter(o => o.delivery_boy_id === p.user_id) || [];
            let status = "Idle";
            if (active.length > 0) {
                status = active.some(o => o.status === 'picked_up') ? "Delivering" : "Picking Up";
            }
            return {
                id: p.user_id,
                name: p.profiles?.full_name,
                phone: p.profiles?.phone,
                status,
                activeCount: active.length
            };
        });

        res.json({ partners: partnerList });
    } catch (error) { next(error); }
});

app.post("/api/grocery/assign-delivery", authenticate, async (req, res, next) => {
    try {
        const { order_id, delivery_boy_id } = req.body;
        const [order] = await restRequest(req.token, `/grocery_orders?id=eq.${order_id}&select=*,grocery_stores(manager_id)`);
        if (!order || order.grocery_stores.manager_id !== req.user.id) {
            throw new HttpError(403, "Unauthorized");
        }

        await restRequest(req.token, `/grocery_orders?id=eq.${order_id}`, {
            method: "PATCH",
            body: { delivery_boy_id, status: 'accepted' }
        });

        res.json({ success: true });
    } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = 3003;
app.listen(PORT, () => console.log(`Grocery Service running on port ${PORT}`));
