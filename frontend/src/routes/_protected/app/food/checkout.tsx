import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useFoodCart } from "@/lib/food-cart";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { DeliveryPinMap, type LatLng } from "@/components/lazy-route-map";
import { PriceBreakdown } from "@/components/price-breakdown";
import { PaymentMethodPicker, type PaymentMethod } from "@/components/payment-method-picker";
import { SavedAddressPicker } from "@/components/saved-address-picker";
import { checkoutSchema, fieldErrors } from "@/lib/validation";
import { OrderReceipt, type ReceiptData } from "@/components/order-receipt";

export const Route = createFileRoute("/_protected/app/food/checkout")({
  component: Checkout,
});

type PlacedOrder = {
  id?: string;
  delivery_pin?: string;
  estimated_delivery_at?: string;
};

type RestaurantDetails = {
    id: string;
    free_delivery_threshold: number;
    delivery_fee: number;
    packaging_fee: number;
    service_tax_pct: number;
    is_raining: boolean;
    rain_fee: number;
    discount_pct: number;
    discount_flat: number;
};

function Checkout() {
  const cart = useFoodCart();
  const [details, setDetails] = useState<RestaurantDetails | null>(null);
  const { user } = useAuth();
  const [address, setAddress] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState<LatLng | null>(null);
  const [notes, setNotes] = useState("");
  const [contactless, setContactless] = useState(false);
  const [addresses, setAddresses] = useState<
    { id: string; label: string; address: string; lat?: number | null; lng?: number | null }[]
  >([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [placing, setPlacing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");

  useEffect(() => {
    api.profile
      .getAddresses()
      .then((data) => setAddresses((data.addresses as typeof addresses) ?? []))
      .catch(() => setAddresses([]));

    if (cart.restaurantId) {
        api.catalog.getRestaurant(cart.restaurantId).then(({ restaurant }) => {
            setDetails(restaurant as RestaurantDetails);
        });
    }
  }, [cart.restaurantId]);

  if (receipt) {
    return <OrderReceipt receipt={receipt} />;
  }

  if (cart.items.length === 0) {
    return (
      <div className="container mx-auto max-w-xl px-4 py-12 text-center">
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <Button asChild className="mt-4">
          <Link to="/app/food">Browse restaurants</Link>
        </Button>
      </div>
    );
  }

  const placeOrder = async () => {
    if (!user || !cart.restaurantId) return;
    const parsed = checkoutSchema.safeParse({ address, deliveryLocation, items: cart.items });
    if (!parsed.success) {
      const nextErrors = fieldErrors(parsed.error);
      setErrors(nextErrors);
      toast.error(Object.values(nextErrors)[0] ?? "Please check checkout details");
      return;
    }
    setErrors({});
    setPlacing(true);

    const subtotal = cart.total();
    const isFree = details && subtotal >= details.free_delivery_threshold;
    const dFee = isFree ? 0 : (details?.delivery_fee || 0);
    const pFee = details?.packaging_fee || 0;
    const rFee = details?.is_raining ? (details?.rain_fee || 0) : 0;
    let disc = (subtotal * ((details?.discount_pct || 0) / 100)) + (details?.discount_flat || 0);

    if (details?.is_bogo_active) {
        cart.items.forEach(item => {
            if (item.quantity >= 2) {
                disc += item.price * Math.floor(item.quantity / 2);
            }
        });
    }

    const tax = (subtotal - disc) * ((details?.service_tax_pct || 0) / 100);
    const platformFee = 10;
    const total = subtotal + dFee + pFee + rFee + tax + platformFee - disc;

    const lines = [
        ...cart.items.map((i) => ({
            label: `${i.quantity} × ${i.name}`,
            amount: i.price * i.quantity,
        })),
        { label: "Delivery Fee", amount: dFee },
        { label: "Packaging Fee", amount: pFee },
        { label: "Rain Fee", amount: rFee },
        { label: "Service Tax", amount: tax },
        { label: "Platform Fee", amount: platformFee },
        { label: "Discount", amount: -disc },
    ];
    try {
      const { order } = await api.orders.placeFood({
        restaurant_id: cart.restaurantId,
        delivery_address: parsed.data.address,
        delivery_lat: parsed.data.deliveryLocation.lat,
        delivery_lng: parsed.data.deliveryLocation.lng,
        notes,
        total,
        payment_method: paymentMethod,
        contactless_delivery: contactless,
        items: cart.items.map((i) => ({
          id: i.id,
          name: i.name,
          price: i.price,
          quantity: i.quantity,
        })),
      });
      const placed = order as PlacedOrder;
      cart.clear();
      setReceipt({
        id: placed.id,
        title: "Order confirmed",
        total,
        address: parsed.data.address,
        deliveryPin: placed.delivery_pin,
        estimatedAt: placed.estimated_delivery_at,
        trackKind: "food",
        lines,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to place order");
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Checkout</h1>

      <div className="mt-6 space-y-4 rounded-2xl border bg-card p-6">
        <h2 className="font-semibold">Order summary</h2>
        {cart.items.map((i) => (
          <div key={i.id} className="flex justify-between text-sm">
            <span>
              {i.quantity} × {i.name}
            </span>
            <span>₹{(i.price * i.quantity).toFixed(0)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t pt-3 font-semibold">
          <span>Total</span>
          <span>₹{cart.total().toFixed(0)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Items are rechecked for availability and price before the order is created.
        </p>
      </div>

      <div className="mt-6 space-y-4 rounded-2xl border bg-card p-6">
        {addresses.length > 0 && (
          <div className="space-y-2">
            <Label>Saved address</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              onChange={(e) => {
                const selected = addresses.find((item) => item.id === e.target.value);
                if (!selected) return;
                setAddress(selected.address);
                if (selected.lat != null && selected.lng != null) {
                  setDeliveryLocation({ lat: selected.lat, lng: selected.lng });
                }
              }}
              defaultValue=""
            >
              <option value="" disabled>
                Choose saved address
              </option>
              {addresses.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-2">
          <Label>Delivery address</Label>
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street, building, apt..."
          />
          {errors.address && <p className="text-xs text-destructive">{errors.address}</p>}
        </div>
        <div className="space-y-2">
          <Label>Pin delivery location</Label>
          <DeliveryPinMap
            value={deliveryLocation}
            onChange={setDeliveryLocation}
            onAddressChange={setAddress}
          />
          {errors.deliveryLocation && (
            <p className="text-xs text-destructive">{errors.deliveryLocation}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="contactless"
            checked={contactless}
            onCheckedChange={(value) => setContactless(value === true)}
          />
          <Label htmlFor="contactless">Contactless delivery</Label>
        </div>
        <div className="space-y-2">
          <Label>Notes (optional)</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Door code, instructions..."
          />
        </div>
        <PaymentMethodPicker value={paymentMethod} onChange={setPaymentMethod} />
        <PriceBreakdown
          lines={lines}
          total={total}
          paymentMethod={paymentMethod}
        />
        <Button
          onClick={placeOrder}
          disabled={placing}
          className="sticky bottom-4 w-full shadow-lg rounded-2xl h-14 font-bold text-lg"
        >
          {placing ? "Placing order..." : `Place order`}
        </Button>
      </div>
    </div>
  );
}
