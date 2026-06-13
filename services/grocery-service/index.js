import express from "express";
import cookieParser from "cookie-parser";
import { prisma } from "../../shared/lib/prisma.mjs";
import { HttpError } from "../../shared/lib/http.mjs";
import { authenticate } from "../../shared/lib/auth.mjs";

const app = express();
app.use(express.json());
app.use(cookieParser());

// --- Grocery Routes ---

app.get("/api/catalog/stores", authenticate, async (req, res, next) => {
  try {
    const stores = await prisma.groceryStore.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json({ stores });
  } catch (error) { next(error); }
});

app.get("/api/catalog/stores/:id", authenticate, async (req, res, next) => {
    try {
        const store = await prisma.groceryStore.findUnique({
            where: { id: req.params.id }
        });
        const items = await prisma.groceryItem.findMany({
            where: { storeId: req.params.id, isAvailable: true }
        });
        res.json({ store, items });
    } catch (error) { next(error); }
});

app.get("/api/catalog/items/grocery", authenticate, async (req, res, next) => {
    try {
        const items = await prisma.groceryItem.findMany({
            where: { isAvailable: true },
            include: { store: { select: { name: true } } },
            take: 12
        });
        res.json({ items });
    } catch (error) { next(error); }
});

app.post("/api/orders/grocery", authenticate, async (req, res, next) => {
    try {
        const { store_id, items, delivery_address, delivery_lat, delivery_lng, notes, payment_method } = req.body;

        const store = await prisma.groceryStore.findUnique({
            where: { id: store_id }
        });
        if (!store) throw new HttpError(404, "Store not found");

        const platformSettings = await prisma.platformSetting.findUnique({
            where: { key: 'fees' }
        });
        const platformFees = platformSettings?.value || { flat_platform_fee: 10 };

        const itemIds = items.map(i => i.grocery_item_id);
        const groceryItems = await prisma.groceryItem.findMany({
            where: { id: { in: itemIds } }
        });

        let subtotal = 0;
        const orderItemsData = items.map(item => {
            const gi = groceryItems.find(m => m.id === item.grocery_item_id);
            if (!gi) throw new HttpError(400, `Item ${item.grocery_item_id} not found`);
            const price = Number(gi.price);
            subtotal += price * item.quantity;
            return {
                groceryItemId: gi.id,
                name: gi.name,
                price: price,
                quantity: item.quantity
            };
        });

        // For grocery, using similar fee logic as food if fields exist on model (I added them to schema for consistency or they could be simplified)
        // Given original schema had delivery_fee etc. I'll use placeholders if not in store model
        let deliveryFee = 25; // Placeholder or from store model
        let packagingFee = 10;
        let rainFee = 0;
        let platformFee = Number(platformFees.flat_platform_fee || 0);

        let discount = 0;
        // ... (can add BOGO logic or other if needed)

        let serviceTax = (subtotal - discount) * 0.05; // 5% tax
        const total = subtotal + deliveryFee + packagingFee + rainFee + platformFee + serviceTax - discount;

        const order = await prisma.groceryOrder.create({
            data: {
                customerId: req.user.id,
                storeId: store_id,
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

app.get("/api/grocery/dashboard", authenticate, async (req, res, next) => {
    try {
        const store = await prisma.groceryStore.findFirst({
            where: { managerId: req.user.id }
        });
        if (!store) return res.json({ store: null, stats: { total: 0, pending: 0, today: 0 } });
        const orders = await prisma.groceryOrder.findMany({
            where: { storeId: store.id },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ store, stats: { total: orders.length, pending: orders.filter(o => o.status === 'pending').length, today: 0 }, orders });
    } catch (error) { next(error); }
});

app.patch("/api/grocery/settings", authenticate, async (req, res, next) => {
    try {
        const store = await prisma.groceryStore.findFirst({
            where: { managerId: req.user.id }
        });
        if (!store) throw new HttpError(404, "Store not found");

        await prisma.groceryStore.update({
            where: { id: store.id },
            data: req.body
        });
        res.json({ success: true });
    } catch (error) { next(error); }
});

app.get("/api/grocery/delivery-partners", authenticate, async (req, res, next) => {
    try {
        const partners = await prisma.userRole.findMany({
            where: { role: 'delivery_boy' },
            include: { user: { include: { profile: true } } }
        });

        const activeOrders = await prisma.groceryOrder.findMany({
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

app.post("/api/grocery/assign-delivery", authenticate, async (req, res, next) => {
    try {
        const { order_id, delivery_boy_id } = req.body;
        const order = await prisma.groceryOrder.findUnique({
            where: { id: order_id },
            include: { store: true }
        });
        if (!order || order.store.managerId !== req.user.id) {
            throw new HttpError(403, "Unauthorized");
        }

        await prisma.groceryOrder.update({
            where: { id: order_id },
            data: { deliveryBoyId: delivery_boy_id, status: 'accepted' }
        });

        res.json({ success: true });
    } catch (error) { next(error); }
});

app.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`Grocery Service running on port ${PORT}`));
