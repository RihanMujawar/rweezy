import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useGroceryCart } from "@/lib/grocery-cart";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { DeliveryPinMap, type LatLng } from "@/components/route-map";

export const Route = createFileRoute("/_protected/app/grocery/checkout")({
  component: GroceryCheckout,
});

function GroceryCheckout() {
  const cart = useGroceryCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [address, setAddress] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState<LatLng | null>(null);
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);

  if (cart.items.length === 0) {
    return (
      <div className="container mx-auto max-w-xl px-4 py-12 text-center">
        <h1 className="text-2xl font-bold">Your cart is empty</h1>
        <Button asChild className="mt-4"><Link to="/app/grocery">Browse stores</Link></Button>
      </div>
    );
  }

  const placeOrder = async () => {
    if (!user || !cart.storeId) return;
    if (!address.trim()) {
      toast.error("Please enter a delivery address");
      return;
    }
    if (!deliveryLocation) {
      toast.error("Please pin your delivery location on the map");
      return;
    }
    setPlacing(true);
    const total = cart.total();
    try {
      await api.orders.placeGrocery({
        store_id: cart.storeId,
        delivery_address: address,
        delivery_lat: deliveryLocation.lat,
        delivery_lng: deliveryLocation.lng,
        notes,
        total,
        items: cart.items.map((i) => ({
          id: i.id,
          name: i.name,
          price: i.price,
          quantity: i.quantity,
        })),
      });
    } catch (error) {
      setPlacing(false);
      toast.error(error instanceof Error ? error.message : "Failed to place order");
      return;
    }
    setPlacing(false);
    cart.clear();
    toast.success("Order placed! 🎉");
    navigate({ to: "/app/orders" });
  };

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Grocery checkout</h1>

      <div className="mt-6 space-y-4 rounded-2xl border bg-card p-6">
        <h2 className="font-semibold">Order summary</h2>
        {cart.items.map((i) => (
          <div key={i.id} className="flex justify-between text-sm">
            <span>{i.quantity} × {i.name}</span>
            <span>${(i.price * i.quantity).toFixed(2)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t pt-3 font-semibold">
          <span>Total</span>
          <span>${cart.total().toFixed(2)}</span>
        </div>
      </div>

      <div className="mt-6 space-y-4 rounded-2xl border bg-card p-6">
        <div className="space-y-2">
          <Label>Delivery address</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, building, apt..." />
        </div>
        <div className="space-y-2">
          <Label>Pin delivery location</Label>
          <DeliveryPinMap value={deliveryLocation} onChange={setDeliveryLocation} />
        </div>
        <div className="space-y-2">
          <Label>Notes (optional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Door code, instructions..." />
        </div>
        <div className="rounded-lg bg-muted p-3 text-sm">Payment: <strong>Cash on delivery</strong></div>
        <Button onClick={placeOrder} disabled={placing} className="w-full">
          {placing ? "Placing order..." : `Place order — $${cart.total().toFixed(2)}`}
        </Button>
      </div>
    </div>
  );
}
