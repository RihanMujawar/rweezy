import express from "express";
import cookieParser from "cookie-parser";
import { prisma } from "../../shared/lib/prisma.mjs";
import { HttpError } from "../../shared/lib/http.mjs";
import { authenticate } from "../../shared/lib/auth.mjs";

const app = express();
app.use(express.json());
app.use(cookieParser());

// --- Food Routes ---

app.get("/api/catalog/restaurants", authenticate, async (req, res, next) => {
  try {
    const restaurants = await prisma.restaurant.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json({ restaurants });
  } catch (error) { next(error); }
});

app.get("/api/catalog/restaurants/:id", authenticate, async (req, res, next) => {
    try {
        const restaurant = await prisma.restaurant.findUnique({
            where: { id: req.params.id }
        });
        const items = await prisma.menuItem.findMany({
            where: { restaurantId: req.params.id, isAvailable: true }
        });
        res.json({ restaurant, items });
    } catch (error) { next(error); }
});

app.get("/api/catalog/items/food", authenticate, async (req, res, next) => {
    try {
        const items = await prisma.menuItem.findMany({
            where: { isAvailable: true },
            include: { restaurant: { select: { name: true } } },
            take: 12
        });
        res.json({ items });
    } catch (error) { next(error); }
});

app.post("/api/orders/food", authenticate, async (req, res, next) => {
    try {
        const { restaurant_id, items, delivery_address, delivery_lat, delivery_lng, notes, payment_method } = req.body;

        const restaurant = await prisma.restaurant.findUnique({
            where: { id: restaurant_id }
        });
        if (!restaurant) throw new HttpError(404, "Restaurant not found");

        const platformSettings = await prisma.platformSetting.findUnique({
            where: { key: 'fees' }
        });
        const platformFees = platformSettings?.value || { flat_platform_fee: 10 };

        const itemIds = items.map(i => i.menu_item_id);
        const menuItems = await prisma.menuItem.findMany({
            where: { id: { in: itemIds } }
        });

        let subtotal = 0;
        const orderItemsData = items.map(item => {
            const mi = menuItems.find(m => m.id === item.menu_item_id);
            if (!mi) throw new HttpError(400, `Item ${item.menu_item_id} not found`);
            const price = Number(mi.price);
            subtotal += price * item.quantity;
            return {
                menuItemId: mi.id,
                name: mi.name,
                price: price,
                quantity: item.quantity
            };
        });

        let deliveryFee = subtotal >= Number(restaurant.freeDeliveryThreshold) ? 0 : Number(restaurant.deliveryFee);
        let packagingFee = Number(restaurant.packagingFee);
        let rainFee = restaurant.isRaining ? Number(restaurant.rainFee) : 0;
        let platformFee = Number(platformFees.flat_platform_fee || 0);

        let discount = 0;
        if (restaurant.discountPct > 0) discount += subtotal * (Number(restaurant.discountPct) / 100);
        if (restaurant.discountFlat > 0) discount += Number(restaurant.discountFlat);

        if (restaurant.isBogoActive) {
            items.forEach(item => {
                if (item.quantity >= 2) {
                    const mi = menuItems.find(m => m.id === item.menu_item_id);
                    const freeUnits = Math.floor(item.quantity / 2);
                    discount += Number(mi.price) * freeUnits;
                }
            });
        }

        let serviceTax = (subtotal - discount) * (Number(restaurant.serviceTaxPct) / 100);
        const total = subtotal + deliveryFee + packagingFee + rainFee + platformFee + serviceTax - discount;

        const order = await prisma.foodOrder.create({
            data: {
                customerId: req.user.id,
                restaurantId: restaurant_id,
                subtotal,
                deliveryFeeApplied: deliveryFee,
                packagingFeeApplied: packagingFee,
                rainFeeApplied: rainFee,
                platformFeeApplied: platformFee,
                serviceTaxApplied: serviceTax,
                discountAmount: discount,
                total,
                deliveryAddress: delivery_address,
                deliveryLat: delivery_lat,
                deliveryLng: delivery_lng,
                notes,
                paymentMethod: payment_method,
                status: 'pending',
                items: {
                    create: orderItemsData
                }
            },
            include: { items: true }
        });

        res.json({ order });
    } catch (error) { next(error); }
});

// Hotel Manager Routes
app.get("/api/hotel/dashboard", authenticate, async (req, res, next) => {
    try {
        const restaurant = await prisma.restaurant.findFirst({
            where: { managerId: req.user.id }
        });
        if (!restaurant) return res.json({ restaurant: null, stats: { total: 0, pending: 0, today: 0 } });
        const orders = await prisma.foodOrder.findMany({
            where: { restaurantId: restaurant.id },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ restaurant, stats: { total: orders.length, pending: orders.filter(o => o.status === 'pending').length, today: 0 }, orders });
    } catch (error) { next(error); }
});

app.patch("/api/hotel/settings", authenticate, async (req, res, next) => {
    try {
        const restaurant = await prisma.restaurant.findFirst({
            where: { managerId: req.user.id }
        });
        if (!restaurant) throw new HttpError(404, "Restaurant not found");

        await prisma.restaurant.update({
            where: { id: restaurant.id },
            data: req.body
        });
        res.json({ success: true });
    } catch (error) { next(error); }
});

app.get("/api/hotel/delivery-partners", authenticate, async (req, res, next) => {
    try {
        const partners = await prisma.userRole.findMany({
            where: { role: 'delivery_boy' },
            include: { user: { include: { profile: true } } }
        });

        const activeOrders = await prisma.foodOrder.findMany({
            where: { status: { in: ['accepted', 'preparing', 'ready', 'picked_up'] } }
        });

        const partnerList = partners.map(p => {
            const active = activeOrders.filter(o => o.deliveryBoyId === p.userId);
            let status = "Idle";
            if (active.length > 0) {
                status = active.some(o => o.status === 'picked_up') ? "Delivering" : "Picking Up";
            }
            return {
                id: p.userId,
                name: p.user.profile?.fullName,
                phone: p.user.profile?.phone,
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
        const order = await prisma.foodOrder.findUnique({
            where: { id: order_id },
            include: { restaurant: true }
        });
        if (!order || order.restaurant.managerId !== req.user.id) {
            throw new HttpError(403, "Unauthorized");
        }

        await prisma.foodOrder.update({
            where: { id: order_id },
            data: { deliveryBoyId: delivery_boy_id, status: 'accepted' }
        });

        res.json({ success: true });
    } catch (error) { next(error); }
});

// --- Delivery Routes ---
app.get("/api/delivery/available", authenticate, async (req, res, next) => {
    try {
        const food = await prisma.foodOrder.findMany({
            where: { deliveryBoyId: null, status: 'pending' },
            include: { restaurant: { select: { name: true } } },
            orderBy: { createdAt: 'desc' }
        });
        const grocery = await prisma.groceryOrder.findMany({
            where: { deliveryBoyId: null, status: 'pending' },
            include: { store: { select: { name: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ food, grocery });
    } catch (error) { next(error); }
});

app.get("/api/delivery/active", authenticate, async (req, res, next) => {
    try {
        const food = await prisma.foodOrder.findMany({
            where: { deliveryBoyId: req.user.id, status: { in: ['accepted', 'preparing', 'ready', 'picked_up'] } },
            include: { restaurant: { select: { name: true } } }
        });
        const grocery = await prisma.groceryOrder.findMany({
            where: { deliveryBoyId: req.user.id, status: { in: ['accepted', 'preparing', 'ready', 'picked_up'] } },
            include: { store: { select: { name: true } } }
        });
        res.json({ food, grocery });
    } catch (error) { next(error); }
});

app.post("/api/delivery/:kind/:id/accept", authenticate, async (req, res, next) => {
    try {
        const { kind, id } = req.params;
        if (kind === 'food') {
            await prisma.foodOrder.update({
                where: { id },
                data: { deliveryBoyId: req.user.id, status: 'accepted' }
            });
        } else {
            await prisma.groceryOrder.update({
                where: { id },
                data: { deliveryBoyId: req.user.id, status: 'accepted' }
            });
        }
        res.json({ success: true });
    } catch (error) { next(error); }
});

app.post("/api/delivery/:kind/:id/advance", authenticate, async (req, res, next) => {
    try {
        const { kind, id } = req.params;
        const { status } = req.body;
        if (kind === 'food') {
            await prisma.foodOrder.update({
                where: { id },
                data: { status }
            });
        } else {
            await prisma.groceryOrder.update({
                where: { id },
                data: { status }
            });
        }
        res.json({ success: true });
    } catch (error) { next(error); }
});

app.get("/api/delivery/history", authenticate, async (req, res, next) => {
    try {
        const food = await prisma.foodOrder.findMany({
            where: { deliveryBoyId: req.user.id, status: { in: ['delivered', 'cancelled'] } },
            include: { restaurant: { select: { name: true } } }
        });
        const grocery = await prisma.groceryOrder.findMany({
            where: { deliveryBoyId: req.user.id, status: { in: ['delivered', 'cancelled'] } },
            include: { store: { select: { name: true } } }
        });
        res.json({ food, grocery });
    } catch (error) { next(error); }
});

app.get("/api/delivery/earnings", authenticate, async (req, res, next) => {
    try {
        res.json({ todayEarnings: 150, monthEarnings: 4500, totalDeliveries: 12 });
    } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`Food Service running on port ${PORT}`));
