import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RoleGate } from "@/components/coming-soon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useAlertsPreference } from "@/hooks/use-alerts-preference";
import { useWebSocket } from "@/lib/websocket-context";
import { Bell, BellOff, Filter, Map as MapIcon, History } from "lucide-react";
import { OrdersMap, MapOrder } from "@/components/orders-map";

export const Route = createFileRoute("/_protected/delivery/")({
  component: DeliveryAvailable,
});

type FoodOrder = {
  id: string;
  status: string;
  total: number;
  delivery_address: string;
  delivery_lat?: number;
  delivery_lng?: number;
  created_at: string;
  restaurants: { name: string } | null;
  profiles?: { full_name: string; phone: string };
};

type GroceryOrder = {
  id: string;
  status: string;
  total: number;
  delivery_address: string;
  delivery_lat?: number;
  delivery_lng?: number;
  created_at: string;
  grocery_stores: { name: string } | null;
  profiles?: { full_name: string; phone: string };
};

function DeliveryAvailable() {
  const { user, roles } = useAuth();
  const { subscribe, isConnected } = useWebSocket();
  const [food, setFood] = useState<FoodOrder[]>([]);
  const [grocery, setGrocery] = useState<GroceryOrder[]>([]);
  const [activeFood, setActiveFood] = useState<FoodOrder[]>([]);
  const [activeGrocery, setActiveGrocery] = useState<GroceryOrder[]>([]);
  const [historyFood, setHistoryFood] = useState<FoodOrder[]>([]);
  const [historyGrocery, setHistoryGrocery] = useState<GroceryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const { alertsEnabled, setAlertsEnabled } = useAlertsPreference();
  const [selectedFood, setSelectedFood] = useState<Set<string>>(new Set());
  const [selectedGrocery, setSelectedGrocery] = useState<Set<string>>(new Set());
  const [minAmount, setMinAmount] = useState(0);
  const [sortBy, setSortBy] = useState<"newest" | "amount">("newest");

  const load = useCallback(async () => {
    const [{ food: f, grocery: g }, { food: af, grocery: ag }] = await Promise.all([
      api.delivery.getAvailable(),
      api.delivery.getActive(),
    ]);
    setFood((f as FoodOrder[]) ?? []);
    setGrocery((g as GroceryOrder[]) ?? []);
    setActiveFood((af as FoodOrder[]) ?? []);
    setActiveGrocery((ag as GroceryOrder[]) ?? []);
    setLoading(false);
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { food: f, grocery: g } = await api.delivery.getHistory();
      setHistoryFood((f as FoodOrder[]) ?? []);
      setHistoryGrocery((g as GroceryOrder[]) ?? []);
    } catch (error) {
      toast.error("Failed to load history");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    load();

    const topic = "dashboard:delivery";
    let wsActive = false;
    let unsubscribeWs: (() => void) | null = null;

    try {
      unsubscribeWs = subscribe(topic, (data) => {
        load();
      });
      wsActive = isConnected;
    } catch (err) {
      console.warn("[WebSocket] Delivery dashboard subscription failed, falling back to polling", err);
      wsActive = false;
    }

    const timer = window.setInterval(() => {
      if (!wsActive || !isConnected) {
        load();
      }
    }, 12000);

    return () => {
      window.clearInterval(timer);
      if (unsubscribeWs) unsubscribeWs();
    };
  }, [load, subscribe, isConnected]);

  const acceptFood = async (id: string) => {
    if (!user) return;
    try {
      await api.delivery.accept("food", id);
      toast.success("Food job accepted");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to accept food job");
    }
  };

  const acceptGrocery = async (id: string) => {
    if (!user) return;
    try {
      await api.delivery.accept("grocery", id);
      toast.success("Grocery job accepted");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to accept grocery job");
    }
  };

  const decline = (label: string) => {
    const reason = window.prompt("Decline reason", "Too far");
    if (reason) toast.message(`${label} hidden for now`, { description: reason });
  };

  const toggleFood = (id: string) =>
    setSelectedFood((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleGrocery = (id: string) =>
    setSelectedGrocery((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const acceptSelected = async (kind: "food" | "grocery") => {
    const ids = kind === "food" ? [...selectedFood] : [...selectedGrocery];
    if (ids.length === 0) return toast.error("Select jobs first");
    await Promise.all(ids.map((id) => api.delivery.accept(kind, id)));
    toast.success(`Accepted ${ids.length} ${kind} job${ids.length > 1 ? "s" : ""}`);
    setSelectedFood(new Set());
    setSelectedGrocery(new Set());
    load();
  };

  const filterAndSort = <T extends FoodOrder | GroceryOrder>(orders: T[]) =>
    [...orders]
      .filter((order) => Number(order.total) >= minAmount)
      .sort((a, b) =>
        sortBy === "amount"
          ? Number(b.total) - Number(a.total)
          : new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

  const visibleFood = filterAndSort(food);
  const visibleGrocery = filterAndSort(grocery);

  const mapOrders: MapOrder[] = [
    ...visibleFood.map((o) => ({
      id: o.id,
      lat: o.delivery_lat || 0,
      lng: o.delivery_lng || 0,
      pickupLat: o.pickup_lat,
      pickupLng: o.pickup_lng,
      customerName: o.profiles?.full_name,
      customerPhone: o.profiles?.phone,
      status: o.status,
      total: o.total,
      type: "food" as const,
      canAccept: true,
    })),
    ...visibleGrocery.map((o) => ({
      id: o.id,
      lat: o.delivery_lat || 0,
      lng: o.delivery_lng || 0,
      pickupLat: o.pickup_lat,
      pickupLng: o.pickup_lng,
      customerName: o.profiles?.full_name,
      customerPhone: o.profiles?.phone,
      status: o.status,
      total: o.total,
      type: "grocery" as const,
      canAccept: true,
    })),
    ...activeFood.map((o) => ({
      id: o.id,
      lat: o.delivery_lat || 0,
      lng: o.delivery_lng || 0,
      pickupLat: o.pickup_lat,
      pickupLng: o.pickup_lng,
      customerName: o.profiles?.full_name,
      customerPhone: o.profiles?.phone,
      status: o.status,
      total: o.total,
      type: "food" as const,
      canAccept: false,
    })),
    ...activeGrocery.map((o) => ({
      id: o.id,
      lat: o.delivery_lat || 0,
      lng: o.delivery_lng || 0,
      pickupLat: o.pickup_lat,
      pickupLng: o.pickup_lng,
      customerName: o.profiles?.full_name,
      customerPhone: o.profiles?.phone,
      status: o.status,
      total: o.total,
      type: "grocery" as const,
      canAccept: false,
    })),
  ].filter((o) => o.lat !== 0);

  const handleAccept = async (id: string, type: MapOrder["type"]) => {
    if (type === "food") await acceptFood(id);
    else if (type === "grocery") await acceptGrocery(id);
  };

  const renderHistory = (list: (FoodOrder | GroceryOrder)[]) =>
    list.length === 0 ? (
      <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">
        No completed deliveries found.
      </p>
    ) : (
      <div className="mt-4 space-y-3">
        {list.map((o) => (
          <div key={o.id} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                {"restaurants" in o
                  ? `🍽️ ${o.restaurants?.name ?? "Restaurant"}`
                  : `🛒 ${o.grocery_stores?.name ?? "Store"}`}
              </h3>
              <Badge variant="secondary" className="capitalize">
                {o.status}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">📍 {o.delivery_address}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="font-medium">₹{Number(o.total).toFixed(2)}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(o.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <RoleGate
      allowed={["delivery_boy", "admin"]}
      hasAny={roles.includes("delivery_boy") || roles.includes("admin")}
    >
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Available deliveries</h1>
            <p className="text-muted-foreground">
              Auto-refreshes every 12 seconds. Select multiple jobs from nearby pickups when
              possible.
            </p>
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

        <div className="mt-6 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-[1fr_auto_auto]">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter className="h-4 w-4" /> Job filters
          </div>
          <Input
            type="number"
            value={minAmount}
            onChange={(event) => setMinAmount(Number(event.target.value))}
            className="min-h-11"
            aria-label="Minimum order amount"
            placeholder="Minimum amount"
          />
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as "newest" | "amount")}
            className="min-h-11 rounded-md border bg-background px-3 text-sm"
            aria-label="Sort jobs"
          >
            <option value="newest">Newest first</option>
            <option value="amount">Highest amount</option>
          </select>
        </div>

        <Tabs defaultValue="orders" className="mt-6">
          <TabsList>
            <TabsTrigger value="orders">
              <MapIcon className="mr-2 h-4 w-4" /> Orders
            </TabsTrigger>
            <TabsTrigger value="history" onClick={loadHistory}>
              <History className="mr-2 h-4 w-4" /> History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            <div className="mt-4 space-y-6">
              <OrdersMap orders={mapOrders} onAccept={handleAccept} height={600} />

              <Tabs defaultValue="food">
                <TabsList>
                  <TabsTrigger value="food">Food Jobs ({visibleFood.length})</TabsTrigger>
                  <TabsTrigger value="grocery">Grocery Jobs ({visibleGrocery.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="food">
            {loading ? (
              <p className="mt-4 text-muted-foreground">Loading...</p>
            ) : visibleFood.length === 0 ? (
              <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">
                No food jobs right now.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {selectedFood.size > 0 && (
                  <Button className="min-h-11" onClick={() => acceptSelected("food")}>
                    Accept selected food jobs ({selectedFood.size})
                  </Button>
                )}
                {visibleFood.map((o) => (
                  <div key={o.id} className="rounded-xl border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedFood.has(o.id)}
                          onCheckedChange={() => toggleFood(o.id)}
                          aria-label={`Select food job ${o.id.slice(0, 8)}`}
                        />
                        <h3 className="font-semibold">🍽️ {o.restaurants?.name ?? "Restaurant"}</h3>
                      </div>
                      <span className="text-xs rounded-full bg-secondary px-2 py-1">
                        {o.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">📍 {o.delivery_address}</p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">${Number(o.total).toFixed(2)}</span>
                      <div className="flex gap-2">
                        <Button size="sm" className="min-h-11" onClick={() => acceptFood(o.id)}>
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-11"
                          onClick={() => decline("Food job")}
                        >
                          Decline
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
                </TabsContent>
                <TabsContent value="grocery">
            {loading ? (
              <p className="mt-4 text-muted-foreground">Loading...</p>
            ) : visibleGrocery.length === 0 ? (
              <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">
                No grocery jobs right now.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {selectedGrocery.size > 0 && (
                  <Button className="min-h-11" onClick={() => acceptSelected("grocery")}>
                    Accept selected grocery jobs ({selectedGrocery.size})
                  </Button>
                )}
                {visibleGrocery.map((o) => (
                  <div key={o.id} className="rounded-xl border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedGrocery.has(o.id)}
                          onCheckedChange={() => toggleGrocery(o.id)}
                          aria-label={`Select grocery job ${o.id.slice(0, 8)}`}
                        />
                        <h3 className="font-semibold">🛒 {o.grocery_stores?.name ?? "Store"}</h3>
                      </div>
                      <span className="text-xs rounded-full bg-secondary px-2 py-1">
                        {o.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">📍 {o.delivery_address}</p>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">₹{Number(o.total).toFixed(2)}</span>
                      <div className="flex gap-2">
                        <Button size="sm" className="min-h-11" onClick={() => acceptGrocery(o.id)}>
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-11"
                          onClick={() => decline("Grocery job")}
                        >
                          Decline
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
                </TabsContent>
              </Tabs>
            </div>
          </TabsContent>

          <TabsContent value="history">
            {loadingHistory ? (
              <p className="mt-4 text-muted-foreground">Loading history...</p>
            ) : (
              <Tabs defaultValue="food_history">
                <TabsList>
                  <TabsTrigger value="food_history">Food ({historyFood.length})</TabsTrigger>
                  <TabsTrigger value="grocery_history">
                    Grocery ({historyGrocery.length})
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="food_history">{renderHistory(historyFood)}</TabsContent>
                <TabsContent value="grocery_history">{renderHistory(historyGrocery)}</TabsContent>
              </Tabs>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </RoleGate>
  );
}
