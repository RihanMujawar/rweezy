import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RoleGate } from "@/components/coming-soon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { Bell, BellOff, ClipboardList, IndianRupee, PackageCheck, Phone, Map as MapIcon } from "lucide-react";
import { useAlertsPreference } from "@/hooks/use-alerts-preference";
import { OrdersMap } from "@/components/lazy-route-map";
import type { MapOrder } from "@/components/orders-map";

export const Route = createFileRoute("/_protected/grocery-admin/orders")({
  component: GroceryOrders,
});

type Order = {
  id: string;
  status: string;
  total: number;
  delivery_address: string;
  delivery_lat?: number;
  delivery_lng?: number;
  notes: string | null;
  created_at: string;
  profiles?: { full_name: string; phone?: string | null };
  grocery_order_items: { id: string; name: string; quantity: number; price: number }[];
};

const NEXT: Record<string, string | null> = {
  pending: "accepted",
  accepted: "preparing",
  preparing: "ready",
  ready: null,
};

function statusColor(status: string) {
  switch (status) {
    case "delivered":
    case "completed":
      return "text-green-600";
    case "cancelled":
      return "text-red-600";
    case "pending":
    case "accepted":
    case "preparing":
      return "text-amber-600";
    case "ready":
      return "text-blue-600";
    default:
      return "text-blue-600";
  }
}

const todayKey = new Date().toDateString();
const isToday = (date: string) => new Date(date).toDateString() === todayKey;

function GroceryOrders() {
  const { user, roles } = useAuth();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [history, setHistory] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const { alertsEnabled, setAlertsEnabled } = useAlertsPreference();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState("active");
  const [mapFilter, setMapFilter] = useState<string>("all");

  const load = useCallback(async () => {
    const { orders } = await api.groceryAdmin.getOrders();
    setOrders((orders as Order[]) ?? []);
    setLoading(false);
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { orders } = await api.groceryAdmin.getHistory();
      setHistory((orders as Order[]) ?? []);
    } catch (error) {
      toast.error("Failed to load order history");
    } finally {
      setLoadingHistory(false);
    }
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
    const timer = window.setInterval(load, 12000);
    return () => window.clearInterval(timer);
  }, [user, load]);

  useEffect(() => {
    if (activeTab === "history") loadHistory();
  }, [activeTab, loadHistory]);

  const advance = async (order: Order) => {
    const next = NEXT[order.status];
    if (!next) return;
    try {
      await api.groceryAdmin.advanceOrder(order.id, next);
      toast.success(`Marked as ${next}`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update order");
    }
  };

  const bulkAdvance = async (next: string) => {
    const targets = orders.filter((order) => selected.has(order.id) && NEXT[order.status] === next);
    if (targets.length === 0) return toast.error(`Select orders that can move to ${next}`);
    await Promise.all(targets.map((order) => api.groceryAdmin.advanceOrder(order.id, next)));
    toast.success(`Updated ${targets.length} order${targets.length > 1 ? "s" : ""}`);
    setSelected(new Set());
    load();
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const todayOrders = orders.filter((order) => isToday(order.created_at));
  const pendingOrders = orders.filter((order) => order.status === "pending");
  const acceptedOrders = orders.filter((order) => order.status === "accepted");
  const preparingOrders = orders.filter((order) => order.status === "preparing");
  const readyOrders = orders.filter((order) => order.status === "ready");
  const todaySales = todayOrders.reduce((sum, order) => sum + Number(order.total), 0);
  const pickList = orders
    .filter((order) => ["accepted", "preparing"].includes(order.status))
    .flatMap((order) =>
      order.grocery_order_items.map((item) => ({
        ...item,
        orderId: order.id,
      })),
    );

  const renderOrderCard = (o: Order, showActions: boolean) => (
    <div key={o.id} className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {showActions && (
            <Checkbox
              checked={selected.has(o.id)}
              onCheckedChange={() => toggleSelected(o.id)}
              aria-label={`Select order ${o.id.slice(0, 8)}`}
              className="mt-1"
            />
          )}
          <div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className={statusColor(o.status)}>
                {o.status}
              </Badge>
              {o.profiles?.full_name && (
                <span className="font-medium text-sm">{o.profiles.full_name}</span>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {new Date(o.created_at).toLocaleString()}
            </span>
          </div>
        </div>
        <span className="font-semibold">₹{Number(o.total).toFixed(2)}</span>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {o.grocery_order_items.map((i) => (
          <li key={i.id}>
            {i.quantity} × {i.name}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-muted-foreground">📍 {o.delivery_address}</p>
      {o.notes && <p className="mt-1 text-sm text-muted-foreground">📝 {o.notes}</p>}
      {showActions && (
        <div className="mt-3 flex flex-wrap gap-2">
          {NEXT[o.status] && (
            <Button size="sm" className="min-h-11" onClick={() => advance(o)}>
              Mark as {NEXT[o.status]}
            </Button>
          )}
          {o.profiles?.phone ? (
            <Button size="sm" variant="outline" className="min-h-11" asChild>
              <a href={`tel:${o.profiles.phone}`}>
                <Phone className="mr-2 h-4 w-4" /> Call customer
              </a>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              onClick={() => toast.message("Customer phone is not attached to this order yet.")}
            >
              <Phone className="mr-2 h-4 w-4" /> Call customer
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="min-h-11"
            onClick={() =>
              navigator.clipboard?.writeText(
                "Hi, we are packing your grocery order now. We will contact you if an item needs substitution.",
              )
            }
          >
            Copy substitution reply
          </Button>
        </div>
      )}
    </div>
  );

  const renderOrderList = (list: Order[]) =>
    list.length === 0 ? (
      <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">
        No orders in this queue.
      </p>
    ) : (
      <div className="mt-4 space-y-3">{list.map((o) => renderOrderCard(o, true))}</div>
    );

  const mapOrders: MapOrder[] = orders
    .filter((o) => o.delivery_lat && o.delivery_lng)
    .filter((o) => mapFilter === "all" || o.status === mapFilter)
    .map((o) => ({
      id: o.id,
      lat: o.delivery_lat!,
      lng: o.delivery_lng!,
      customerName: o.profiles?.full_name,
      status: o.status,
      total: o.total,
      items: o.grocery_order_items,
      type: "grocery",
    }));

  return (
    <RoleGate
      allowed={["grocery_manager", "admin"]}
      hasAny={roles.includes("grocery_manager") || roles.includes("admin")}
    >
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Grocery orders</h1>
            <p className="text-sm text-muted-foreground">Auto-refreshes every 12 seconds.</p>
          </div>
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => setAlertsEnabled((value) => !value)}
          >
            {alertsEnabled ? (
              <Bell className="mr-2 h-4 w-4" />
            ) : (
              <BellOff className="mr-2 h-4 w-4" />
            )}
            {alertsEnabled ? "Alerts on" : "Alerts off"}
          </Button>
        </div>
        {loading ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground">Today orders</p>
                <p className="mt-1 text-2xl font-bold">{todayOrders.length}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground">Today sales</p>
                <p className="mt-1 flex items-center text-2xl font-bold">
                  <IndianRupee className="h-5 w-5" />
                  {todaySales.toFixed(0)}
                </p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground">New orders</p>
                <p className="mt-1 text-2xl font-bold">{pendingOrders.length}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground">Pick list items</p>
                <p className="mt-1 flex items-center text-2xl font-bold">
                  <PackageCheck className="mr-1 h-5 w-5" />
                  {pickList.length}
                </p>
              </div>
            </div>

            {selected.size > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
                <span className="text-sm font-medium">{selected.size} selected</span>
                <Button size="sm" onClick={() => bulkAdvance("accepted")}>
                  Accept selected
                </Button>
                <Button size="sm" onClick={() => bulkAdvance("preparing")}>
                  Start packing
                </Button>
                <Button size="sm" onClick={() => bulkAdvance("ready")}>
                  Mark packed
                </Button>
              </div>
            )}

            <TabsList className="mt-4 flex-wrap">
              <TabsTrigger value="active">All active ({orders.length})</TabsTrigger>
              <TabsTrigger value="map">
                <MapIcon className="mr-2 h-4 w-4" /> Map View
              </TabsTrigger>
              <TabsTrigger value="new">New ({pendingOrders.length})</TabsTrigger>
              <TabsTrigger value="accepted">Accepted ({acceptedOrders.length})</TabsTrigger>
              <TabsTrigger value="preparing">Packing ({preparingOrders.length})</TabsTrigger>
              <TabsTrigger value="ready">Ready ({readyOrders.length})</TabsTrigger>
              <TabsTrigger value="pick">Pick list ({pickList.length})</TabsTrigger>
              <TabsTrigger value="today">Today ({todayOrders.length})</TabsTrigger>
              <TabsTrigger value="history">Order History ({history.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="active">{renderOrderList(orders)}</TabsContent>
            <TabsContent value="map">
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={mapFilter === "all" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMapFilter("all")}
                  >
                    All
                  </Button>
                  <Button
                    variant={mapFilter === "pending" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMapFilter("pending")}
                  >
                    New
                  </Button>
                  <Button
                    variant={mapFilter === "accepted" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMapFilter("accepted")}
                  >
                    Accepted
                  </Button>
                  <Button
                    variant={mapFilter === "preparing" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMapFilter("preparing")}
                  >
                    Packing
                  </Button>
                  <Button
                    variant={mapFilter === "ready" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMapFilter("ready")}
                  >
                    Ready
                  </Button>
                </div>
                <OrdersMap orders={mapOrders} height={600} />
              </div>
            </TabsContent>
            <TabsContent value="new">{renderOrderList(pendingOrders)}</TabsContent>
            <TabsContent value="accepted">{renderOrderList(acceptedOrders)}</TabsContent>
            <TabsContent value="preparing">{renderOrderList(preparingOrders)}</TabsContent>
            <TabsContent value="ready">{renderOrderList(readyOrders)}</TabsContent>
            <TabsContent value="pick">
              {pickList.length === 0 ? (
                <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">
                  Nothing to pick right now.
                </p>
              ) : (
                <div className="mt-4 overflow-hidden rounded-lg border bg-card">
                  {pickList.map((item) => (
                    <label
                      key={`${item.orderId}-${item.id}`}
                      className="flex min-h-12 items-center gap-3 border-b px-4 py-3 last:border-b-0"
                    >
                      <Checkbox aria-label={`Picked ${item.name}`} />
                      <span className="font-medium">
                        {item.quantity} x {item.name}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        Order {item.orderId.slice(0, 8)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="today">{renderOrderList(todayOrders)}</TabsContent>

            <TabsContent value="history">
              {loadingHistory ? (
                <p className="mt-8 text-muted-foreground">Loading history...</p>
              ) : history.length === 0 ? (
                <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">
                  No order history yet.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="mb-4 rounded-lg bg-muted p-3 text-sm">
                    Showing completed, delivered, and cancelled orders.
                  </div>
                  {history
                    .filter((o) => ["completed", "delivered", "cancelled"].includes(o.status))
                    .map((o) => renderOrderCard(o, false))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </RoleGate>
  );
}
