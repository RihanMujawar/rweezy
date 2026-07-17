import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RoleGate } from "@/components/coming-soon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRiderBroadcast } from "@/lib/use-rider-broadcast";
import { api } from "@/lib/api";
import { RouteMap, StaticPointMap, type LatLng } from "@/components/lazy-route-map";
import { ChatPanel } from "@/components/chat-panel";
import { DeliveryPinDialog } from "@/components/delivery-pin-dialog";
import { NavigationButton } from "@/components/navigation-button";
import { PageLoadingSkeleton } from "@/components/loading-skeleton";

export const Route = createFileRoute("/_protected/delivery/active")({
  component: DeliveryActive,
});

type FoodOrder = {
  id: string;
  status: string;
  total: number;
  delivery_address: string;
  delivery_lat: number | null;
  delivery_lng: number | null;
  rider_lat: number | null;
  rider_lng: number | null;
  restaurants: { name: string } | null;
  customer?: { full_name?: string | null; phone?: string | null } | null;
};

type GroceryOrder = {
  id: string;
  status: string;
  total: number;
  delivery_address: string;
  delivery_lat: number | null;
  delivery_lng: number | null;
  rider_lat: number | null;
  rider_lng: number | null;
  grocery_stores: { name: string } | null;
  customer?: { full_name?: string | null; phone?: string | null } | null;
};

type PendingAdvance = {
  table: "food_orders" | "grocery_orders";
  id: string;
  status: string;
};

type HistoryOrder = {
  id: string;
  status: string;
  total: number;
  delivery_address: string;
  created_at: string;
  restaurants?: { name: string } | null;
  grocery_stores?: { name: string } | null;
};

const NEXT: Record<string, string | null> = {
  ready: "picked_up",
  picked_up: "delivered",
  preparing: "picked_up",
};

function statusColor(status: string) {
  switch (status) {
    case "delivered":
    case "completed":
      return "text-green-600";
    case "cancelled":
      return "text-red-600";
    case "pending":
    case "requested":
      return "text-amber-600";
    default:
      return "text-blue-600";
  }
}

function DeliveryActive() {
  const { user, roles } = useAuth();
  const [food, setFood] = useState<FoodOrder[]>([]);
  const [grocery, setGrocery] = useState<GroceryOrder[]>([]);
  const [historyFood, setHistoryFood] = useState<HistoryOrder[]>([]);
  const [historyGrocery, setHistoryGrocery] = useState<HistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [earnings, setEarnings] = useState<{ todayEarnings: number; monthEarnings: number } | null>(
    null,
  );
  const [pendingAdvance, setPendingAdvance] = useState<PendingAdvance | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { food: f, grocery: g } = await api.delivery.getActive();
    setFood((f as FoodOrder[]) ?? []);
    setGrocery((g as GroceryOrder[]) ?? []);
  }, [user]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { food: f, grocery: g } = await api.delivery.getHistory();
      setHistoryFood((f as HistoryOrder[]) ?? []);
      setHistoryGrocery((g as HistoryOrder[]) ?? []);
    } catch (error) {
      toast.error("Failed to load delivery history");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    api.delivery
      .getEarnings()
      .then(setEarnings)
      .catch(() => setEarnings(null));
  }, [load]);

  // Broadcast live location for the first in-flight order in each list
  const activeFood = food.find(
    (o) => o.status === "picked_up" || o.status === "ready" || o.status === "preparing",
  );
  const activeGrocery = grocery.find(
    (o) => o.status === "picked_up" || o.status === "ready" || o.status === "preparing",
  );
  useRiderBroadcast(activeFood ? "food_orders" : null, activeFood?.id ?? null, !!activeFood);
  useRiderBroadcast(
    activeGrocery ? "grocery_orders" : null,
    activeGrocery?.id ?? null,
    !!activeGrocery,
  );

  const advance = async (
    table: "food_orders" | "grocery_orders",
    o: { id: string; status: string },
    deliveryPin?: string,
  ) => {
    const next = NEXT[o.status];
    if (!next) return;
    if (next === "delivered" && !deliveryPin) {
      setPendingAdvance({ table, id: o.id, status: o.status });
      return;
    }
    try {
      await api.delivery.advance(
        table === "food_orders" ? "food" : "grocery",
        o.id,
        next,
        deliveryPin,
      );
      toast.success(`Marked ${next}`);
      load();
      api.delivery
        .getEarnings()
        .then(setEarnings)
        .catch(() => undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update delivery");
    }
  };

  const renderActiveList = <
    T extends {
      id: string;
      status: string;
      total: number;
      delivery_address: string;
      delivery_lat?: number | null;
      delivery_lng?: number | null;
      rider_lat?: number | null;
      rider_lng?: number | null;
      customer?: { full_name?: string | null; phone?: string | null } | null;
    },
  >(
    list: T[],
    table: "food_orders" | "grocery_orders",
    nameOf: (o: T) => string,
    icon: string,
  ) =>
    list.length === 0 ? (
      <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">
        No active deliveries.
      </p>
    ) : (
      <div className="mt-4 space-y-3">
        {list.map((o) => (
          <div key={o.id} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {icon} {nameOf(o)}
              </h3>
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase font-bold text-muted-foreground">{o.status}</span>
                {o.customer?.full_name && (
                  <span className="text-xs font-medium">{o.customer.full_name}</span>
                )}
              </div>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">📍 {o.delivery_address}</p>
            {o.customer?.phone && (
              <a href={`tel:${o.customer.phone}`} className="mt-1 block text-xs text-primary hover:underline">
                📞 {o.customer.phone}
              </a>
            )}
            {(() => {
              const delivery =
                o.delivery_lat != null && o.delivery_lng != null
                  ? ({ lat: o.delivery_lat, lng: o.delivery_lng } as LatLng)
                  : null;
              const rider =
                o.rider_lat != null && o.rider_lng != null
                  ? ({ lat: o.rider_lat, lng: o.rider_lng } as LatLng)
                  : null;

              if (!delivery) return null;

              return (
                <div className="mt-3">
                  {rider ? (
                    <RouteMap pickup={rider} drop={delivery} rider={rider} height={220} />
                  ) : (
                    <StaticPointMap point={delivery} height={220} />
                  )}
                </div>
              );
            })()}
            <div className="mt-2 flex items-center justify-between">
              <span className="font-medium">₹{Number(o.total).toFixed(2)}</span>
              {NEXT[o.status] && (
                <Button size="sm" onClick={() => advance(table, o)}>
                  Mark {NEXT[o.status]}
                </Button>
              )}
            </div>
            <div className="mt-3">
              <ChatPanel
                kind={table === "food_orders" ? "food" : "grocery"}
                serviceId={o.id}
                title="Chat with customer"
              />
            </div>
          </div>
        ))}
      </div>
    );

  const renderHistoryList = (
    list: HistoryOrder[],
    icon: string,
    nameOf: (o: HistoryOrder) => string,
  ) =>
    list.length === 0 ? (
      <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">
        No delivery history.
      </p>
    ) : (
      <div className="mt-4 space-y-3">
        {list.map((o) => (
          <div key={o.id} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {icon} {nameOf(o)}
              </h3>
              <span
                className={`text-xs rounded-full px-2 py-1 font-medium ${statusColor(o.status)}`}
              >
                {o.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">📍 {o.delivery_address}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {new Date(o.created_at).toLocaleString()}
              </span>
              <span className="font-medium">₹{Number(o.total).toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <RoleGate
      allowed={["delivery_boy", "admin", "all_in_one_partner"]}
      hasAny={roles.includes("delivery_boy") || roles.includes("admin") || roles.includes("all_in_one_partner")}
    >
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold">Deliveries</h1>
        {earnings && (
          <p className="mt-2 text-sm text-muted-foreground">
            Earnings — today ₹{earnings.todayEarnings.toFixed(0)}, this month ₹
            {earnings.monthEarnings.toFixed(0)}
          </p>
        )}
        {loading ? (
          <PageLoadingSkeleton />
        ) : (
          <Tabs defaultValue="active" className="mt-6">
            <TabsList>
              <TabsTrigger value="active">Active ({food.length + grocery.length})</TabsTrigger>
              <TabsTrigger value="history" onClick={() => loadHistory()}>
                History ({historyFood.length + historyGrocery.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="active">
              <Tabs defaultValue="food" className="mt-4">
                <TabsList>
                  <TabsTrigger value="food">Food ({food.length})</TabsTrigger>
                  <TabsTrigger value="grocery">Grocery ({grocery.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="food">
                  {renderActiveList(
                    food,
                    "food_orders",
                    (o) => o.restaurants?.name ?? "Restaurant",
                    "🍽️",
                  )}
                </TabsContent>
                <TabsContent value="grocery">
                  {renderActiveList(
                    grocery,
                    "grocery_orders",
                    (o) => o.grocery_stores?.name ?? "Store",
                    "🛒",
                  )}
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="history">
              {loadingHistory ? (
                <p className="mt-8 text-muted-foreground">Loading history...</p>
              ) : (
                <Tabs defaultValue="food" className="mt-4">
                  <TabsList>
                    <TabsTrigger value="food">Food ({historyFood.length})</TabsTrigger>
                    <TabsTrigger value="grocery">Grocery ({historyGrocery.length})</TabsTrigger>
                  </TabsList>
                  <TabsContent value="food">
                    {renderHistoryList(
                      historyFood,
                      "🍽️",
                      (o) => o.restaurants?.name ?? "Restaurant",
                    )}
                  </TabsContent>
                  <TabsContent value="grocery">
                    {renderHistoryList(
                      historyGrocery,
                      "🛒",
                      (o) => o.grocery_stores?.name ?? "Store",
                    )}
                  </TabsContent>
                </Tabs>
              )}
            </TabsContent>
          </Tabs>
        )}
        <DeliveryPinDialog
          open={!!pendingAdvance}
          onOpenChange={(open) => !open && setPendingAdvance(null)}
          title="Confirm delivery"
          description="Ask the customer for their 4-digit delivery PIN."
          onConfirm={async (pin) => {
            if (!pendingAdvance) return;
            const list = pendingAdvance.table === "food_orders" ? food : grocery;
            const order = list.find((item) => item.id === pendingAdvance.id);
            if (!order) return;
            await advance(pendingAdvance.table, order, pin);
            setPendingAdvance(null);
          }}
        />
      </div>
    </RoleGate>
  );
}
