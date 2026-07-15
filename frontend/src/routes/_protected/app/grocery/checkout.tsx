import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useGroceryCart } from "@/lib/grocery-cart";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { DeliveryPinMap, type LatLng } from "@/components/lazy-route-map";
import { OrderReceipt, type ReceiptData } from "@/components/order-receipt";
import { PriceBreakdown } from "@/components/price-breakdown";
import { PaymentMethodPicker, type PaymentMethod } from "@/components/payment-method-picker";
import { SavedAddressPicker } from "@/components/saved-address-picker";
import { checkoutSchema, fieldErrors } from "@/lib/validation";

export const Route = createFileRoute("/_protected/app/grocery/checkout")({
  component: GroceryCheckout,
});

function GroceryCheckout() {
  const cart = useGroceryCart();
  const { user } = useAuth();
  const [address, setAddress] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState<LatLng | null>(null);
  const [notes, setNotes] = useState("");
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
  }, []);

  if (receipt) {
    return <OrderReceipt receipt={receipt} />;
  }

  if (cart.items.length === 0) {
    return (
      <div className="container mx-auto max-w-xl px-4 py-12 text-center">
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <Button asChild className="mt-4">
          <Link to="/app/grocery">Browse stores</Link>
        </Button>
      </div>
    );
  }

  const placeOrder = async () => {
    if (!user || !cart.storeId) return;
    const parsed = checkoutSchema.safeParse({ address, deliveryLocation, items: cart.items });
    if (!parsed.success) {
      const nextErrors = fieldErrors(parsed.error);
      setErrors(nextErrors);
      toast.error(Object.values(nextErrors)[0] ?? "Please check checkout details");
      return;
    }
    setErrors({});
    setPlacing(true);
    const total = cart.total();
    const deliveryFee = Math.max(20, Math.round(total * 0.08));
    const lines = cart.items.map((i) => ({
      label: `${i.quantity} × ${i.name}`,
      amount: i.price * i.quantity,
    }));
    try {
      const { order } = await api.orders.placeGrocery({
        store_id: cart.storeId,
        delivery_address: parsed.data.address,
        delivery_lat: parsed.data.deliveryLocation.lat,
        delivery_lng: parsed.data.deliveryLocation.lng,
        notes,
        total,
        payment_method: paymentMethod,
        items: cart.items.map((i) => ({
          id: i.id,
          name: i.name,
          price: i.price,
          quantity: i.quantity,
        })),
      });
      const placed = order as {
        id?: string;
        delivery_pin?: string;
        estimated_delivery_at?: string;
      };
      cart.clear();
      setReceipt({
        id: placed.id,
        title: "Grocery order confirmed",
        address: parsed.data.address,
        deliveryPin: placed.delivery_pin,
        estimatedAt: placed.estimated_delivery_at,
        trackKind: "grocery",
        lines: [...lines, { label: "Delivery fee", amount: deliveryFee }],
        total: total + deliveryFee,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to place order");
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Grocery checkout</h1>

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
          Items are rechecked for availability and quantity limits before the order is created.
        </p>
      </div>

      <div className="mt-6 space-y-4 rounded-2xl border bg-card p-6">
        {addresses.length > 0 && (
          <div className="space-y-2">
            <Label>Saved address</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {addresses.map((item) => (
                <Button
                  key={item.id}
                  variant={address === item.address ? "default" : "outline"}
                  className="h-auto flex-col items-start p-3 text-left"
                  onClick={() => {
                    setAddress(item.address);
                    if (item.lat != null && item.lng != null) {
                      setDeliveryLocation({ lat: item.lat, lng: item.lng });
                    }
                  }}
                >
                  <span className="font-semibold">{item.label}</span>
                  <span className="mt-1 line-clamp-1 text-[10px] opacity-70">
                    {item.address}
                  </span>
                </Button>
              ))}
            </div>
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
          lines={[
            ...cart.items.map((i) => ({
              label: `${i.quantity} × ${i.name}`,
              amount: i.price * i.quantity,
            })),
            { label: "Delivery fee", amount: Math.max(20, Math.round(cart.total() * 0.08)) },
          ]}
          total={cart.total() + Math.max(20, Math.round(cart.total() * 0.08))}
          paymentMethod={paymentMethod}
        />
        <Button
          onClick={placeOrder}
          disabled={placing}
          className="sticky bottom-4 w-full shadow-lg"
        >
          {placing ? "Placing order..." : `Place order — ₹${cart.total().toFixed(0)}`}
        </Button>
      </div>
    </div>
  );
}
