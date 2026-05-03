import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RoleGate } from "@/components/coming-soon";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/grocery-admin/orders")({
  component: GroceryOrders,
});

type Order = {
  id: string;
  status: string;
  total: number;
  delivery_address: string;
  notes: string | null;
  created_at: string;
  grocery_order_items: { id: string; name: string; quantity: number; price: number }[];
};

const NEXT: Record<string, string | null> = {
  pending: "accepted",
  accepted: "preparing",
  preparing: "ready",
  ready: null,
};

function GroceryOrders() {
  const { user, roles } = useAuth();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (sid: string) => {
    const { orders } = await api.groceryAdmin.getOrders();
    setOrders((orders as Order[]) ?? []);
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { storeId: sid, orders } = await api.groceryAdmin.getOrders();
      if (sid) {
        setStoreId(sid);
        setOrders((orders as Order[]) ?? []);
      }
      setLoading(false);
    })();
  }, [user, load]);

  const advance = async (order: Order) => {
    const next = NEXT[order.status];
    if (!next) return;
    try {
      await api.groceryAdmin.advanceOrder(order.id, next);
      toast.success(`Marked as ${next}`);
      if (storeId) load(storeId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update order");
    }
  };

  return (
    <RoleGate allowed={["grocery_manager", "admin"]} hasAny={roles.includes("grocery_manager") || roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold">Incoming orders</h1>
        {loading ? (
          <p className="mt-4 text-muted-foreground">Loading...</p>
        ) : orders.length === 0 ? (
          <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">No orders.</p>
        ) : (
          <div className="mt-6 space-y-3">
            {orders.map((o) => (
              <div key={o.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="rounded-full bg-secondary px-2 py-1 text-xs">{o.status}</span>
                    <span className="ml-2 text-sm text-muted-foreground">{new Date(o.created_at).toLocaleString()}</span>
                  </div>
                  <span className="font-semibold">${Number(o.total).toFixed(2)}</span>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {o.grocery_order_items.map((i) => <li key={i.id}>{i.quantity} × {i.name}</li>)}
                </ul>
                <p className="mt-2 text-sm text-muted-foreground">📍 {o.delivery_address}</p>
                {o.notes && <p className="mt-1 text-sm text-muted-foreground">📝 {o.notes}</p>}
                {NEXT[o.status] && (
                  <Button size="sm" className="mt-3" onClick={() => advance(o)}>Mark as {NEXT[o.status]}</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </RoleGate>
  );
}
