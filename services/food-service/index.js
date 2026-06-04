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
        const { restaurant_id, items, delivery_address, delivery_lat, delivery_lng, notes, payment_method } = req.body;

        // 1. Fetch restaurant settings and platform settings
        const [restaurantRows, platformSettings] = await Promise.all([
            restRequest(req.token, `/restaurants?id=eq.${restaurant_id}`),
            restRequest(req.token, `/platform_settings?key=eq.fees`)
        ]);
        const restaurant = restaurantRows?.[0];
        if (!restaurant) throw new HttpError(404, "Restaurant not found");
        const platformFees = platformSettings?.[0]?.value || { flat_platform_fee: 10 };

        // 2. Fetch menu items to verify prices
        const itemIds = items.map(i => i.menu_item_id);
        const menuItems = await restRequest(req.token, `/menu_items?id=in.(${itemIds.join(",")})`);

        // 3. Calculate subtotal
        let subtotal = 0;
        const orderItems = items.map(item => {
            const mi = menuItems.find(m => m.id === item.menu_item_id);
            if (!mi) throw new HttpError(400, `Item ${item.menu_item_id} not found`);
            const price = Number(mi.price);
            subtotal += price * item.quantity;
            return {
                menu_item_id: mi.id,
                name: mi.name,
                price: price,
                quantity: item.quantity
            };
        });

        // 4. Calculate fees and discounts
        let deliveryFee = subtotal >= Number(restaurant.free_delivery_threshold) ? 0 : Number(restaurant.delivery_fee);
        let packagingFee = Number(restaurant.packaging_fee);
        let rainFee = restaurant.is_raining ? Number(restaurant.rain_fee) : 0;
        let platformFee = Number(platformFees.flat_platform_fee || 0);

        let discount = 0;
        if (restaurant.discount_pct > 0) discount += subtotal * (Number(restaurant.discount_pct) / 100);
        if (restaurant.discount_flat > 0) discount += Number(restaurant.discount_flat);

        // BOGO Logic: If active, deduct price of 1 item for every 2 items of same ID
        if (restaurant.is_bogo_active) {
            items.forEach(item => {
                if (item.quantity >= 2) {
                    const mi = menuItems.find(m => m.id === item.menu_item_id);
                    const freeUnits = Math.floor(item.quantity / 2);
                    discount += Number(mi.price) * freeUnits;
                }
            });
        }

        let serviceTax = (subtotal - discount) * (Number(restaurant.service_tax_pct) / 100);

        const total = subtotal + deliveryFee + packagingFee + rainFee + platformFee + serviceTax - discount;

        // 5. Create Order
        const orderData = {
            customer_id: req.user.id,
            restaurant_id,
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

        const [order] = await restRequest(req.token, "/food_orders", {
            method: "POST",
            body: orderData,
            headers: { "Prefer": "return=representation" }
        });

        // 6. Create Order Items
        await restRequest(req.token, "/food_order_items", {
            method: "POST",
            body: orderItems.map(oi => ({ ...oi, order_id: order.id }))
        });

        res.json({ order });
    } catch (error) { next(error); }
});

// Hotel Manager Routes
app.get("/api/hotel/dashboard", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/restaurants?manager_id=eq." + req.user.id);
        const restaurant = rows?.[0];
        if (!restaurant) return res.json({ restaurant: null, stats: { total: 0, pending: 0, today: 0 } });
        const orders = await restRequest(req.token, "/food_orders?restaurant_id=eq." + restaurant.id + "&order=created_at.desc");
        res.json({ restaurant, stats: { total: orders?.length ?? 0, pending: orders?.filter(o => o.status === 'pending').length ?? 0, today: 0 }, orders });
    } catch (error) { next(error); }
});

app.patch("/api/hotel/settings", authenticate, async (req, res, next) => {
    try {
        const rows = await restRequest(req.token, "/restaurants?manager_id=eq." + req.user.id);
        const restaurant = rows?.[0];
        if (!restaurant) throw new HttpError(404, "Restaurant not found");

        const updated = await restRequest(req.token, `/restaurants?id=eq.${restaurant.id}`, {
            method: "PATCH",
            body: req.body
        });
        res.json({ success: true });
    } catch (error) { next(error); }
});

app.get("/api/hotel/delivery-partners", authenticate, async (req, res, next) => {
    try {
        // Fetch all delivery boys and their active orders to determine status
        const [partners, activeOrders] = await Promise.all([
            restRequest(req.token, "/user_roles?role=eq.delivery_boy&select=user_id,profiles(full_name,phone)"),
            restRequest(req.token, "/food_orders?status=in.(accepted,preparing,ready,picked_up)&select=delivery_boy_id,status")
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

app.post("/api/hotel/assign-delivery", authenticate, async (req, res, next) => {
    try {
        const { order_id, delivery_boy_id } = req.body;
        // Verify ownership
        const [order] = await restRequest(req.token, `/food_orders?id=eq.${order_id}&select=*,restaurants(manager_id)`);
        if (!order || order.restaurants.manager_id !== req.user.id) {
            throw new HttpError(403, "Unauthorized");
        }

        await restRequest(req.token, `/food_orders?id=eq.${order_id}`, {
            method: "PATCH",
            body: { delivery_boy_id, status: 'accepted' }
        });

        res.json({ success: true });
    } catch (error) { next(error); }
});

// --- Delivery Routes ---
app.get("/api/delivery/available", authenticate, async (req, res, next) => {
    try {
        const [food, grocery] = await Promise.all([
            restRequest(req.token, "/food_orders?delivery_boy_id=is.null&status=eq.pending&select=*,restaurants(name)"),
            restRequest(req.token, "/grocery_orders?delivery_boy_id=is.null&status=eq.pending&select=*,grocery_stores(name)")
        ]);
        res.json({ food: food ?? [], grocery: grocery ?? [] });
    } catch (error) { next(error); }
});

app.get("/api/delivery/active", authenticate, async (req, res, next) => {
    try {
        const [food, grocery] = await Promise.all([
            restRequest(req.token, `/food_orders?delivery_boy_id=eq.${req.user.id}&status=in.(accepted,preparing,ready,picked_up)&select=*,restaurants(name)`),
            restRequest(req.token, `/grocery_orders?delivery_boy_id=eq.${req.user.id}&status=in.(accepted,preparing,ready,picked_up)&select=*,grocery_stores(name)`)
        ]);
        res.json({ food: food ?? [], grocery: grocery ?? [] });
    } catch (error) { next(error); }
});

app.post("/api/delivery/:kind/:id/accept", authenticate, async (req, res, next) => {
    try {
        const { kind, id } = req.params;
        const table = kind === 'food' ? '/food_orders' : '/grocery_orders';
        await restRequest(req.token, `${table}?id=eq.${id}`, {
            method: "PATCH",
            body: { delivery_boy_id: req.user.id, status: 'accepted' }
        });
        res.json({ success: true });
    } catch (error) { next(error); }
});

app.post("/api/delivery/:kind/:id/advance", authenticate, async (req, res, next) => {
    try {
        const { kind, id } = req.params;
        const { status } = req.body;
        const table = kind === 'food' ? '/food_orders' : '/grocery_orders';
        await restRequest(req.token, `${table}?id=eq.${id}`, {
            method: "PATCH",
            body: { status }
        });
        res.json({ success: true });
    } catch (error) { next(error); }
});

app.get("/api/delivery/history", authenticate, async (req, res, next) => {
    try {
        const [food, grocery] = await Promise.all([
            restRequest(req.token, `/food_orders?delivery_boy_id=eq.${req.user.id}&status=in.(delivered,cancelled)&select=*,restaurants(name)`),
            restRequest(req.token, `/grocery_orders?delivery_boy_id=eq.${req.user.id}&status=in.(delivered,cancelled)&select=*,grocery_stores(name)`)
        ]);
        res.json({ food: food ?? [], grocery: grocery ?? [] });
    } catch (error) { next(error); }
});

app.get("/api/delivery/earnings", authenticate, async (req, res, next) => {
    try {
        // Mock earnings for now
        res.json({ todayEarnings: 150, monthEarnings: 4500, totalDeliveries: 12 });
    } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = 3002;
app.listen(PORT, () => console.log(`Food Service running on port ${PORT}`));
