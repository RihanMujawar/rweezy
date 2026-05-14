import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RoleGate } from "@/components/coming-soon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRiderBroadcast } from "@/lib/use-rider-broadcast";
import { api } from "@/lib/api";
import { RouteMap, StaticPointMap, type LatLng } from "@/components/route-map";
import { ChatPanel } from "@/components/chat-panel";

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
};

const NEXT: Record<string, string | null> = {
  ready: "picked_up",
  picked_up: "delivered",
  preparing: "picked_up",
};

function DeliveryActive() {
  const { user, roles } = useAuth();
  const [food, setFood] = useState<FoodOrder[]>([]);
  const [grocery, setGrocery] = useState<GroceryOrder[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    const { food: f, grocery: g } = await api.delivery.getActive();
    setFood((f as FoodOrder[]) ?? []);
    setGrocery((g as GroceryOrder[]) ?? []);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Broadcast live location for the first in-flight order in each list
  const activeFood = food.find((o) => o.status === "picked_up" || o.status === "ready" || o.status === "preparing");
  const activeGrocery = grocery.find((o) => o.status === "picked_up" || o.status === "ready" || o.status === "preparing");
  useRiderBroadcast(activeFood ? "food_orders" : null, activeFood?.id ?? null, !!activeFood);
  useRiderBroadcast(activeGrocery ? "grocery_orders" : null, activeGrocery?.id ?? null, !!activeGrocery);

  const advance = async (table: "food_orders" | "grocery_orders", o: { id: string; status: string }) => {
    const next = NEXT[o.status];
    if (!next) return;
    try {
      await api.delivery.advance(table === "food_orders" ? "food" : "grocery", o.id, next);
      toast.success(`Marked ${next}`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update delivery");
    }
  };

  const renderList = <T extends { id: string; status: string; total: number; delivery_address: string }>(
    list: T[],
    table: "food_orders" | "grocery_orders",
    nameOf: (o: T) => string,
    icon: string,
  ) => (
    list.length === 0 ? (
      <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">No active deliveries.</p>
    ) : (
      <div className="mt-4 space-y-3">
        {list.map((o) => (
          <div key={o.id} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{icon} {nameOf(o)}</h3>
              <span className="text-xs rounded-full bg-secondary px-2 py-1">{o.status}</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">📍 {o.delivery_address}</p>
            {(() => {
              const delivery = "delivery_lat" in o && o.delivery_lat != null && o.delivery_lng != null
                ? ({ lat: o.delivery_lat, lng: o.delivery_lng } as LatLng)
                : null;
              const rider = "rider_lat" in o && o.rider_lat != null && o.rider_lng != null
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
              <span className="font-medium">${Number(o.total).toFixed(2)}</span>
              {NEXT[o.status] && <Button size="sm" onClick={() => advance(table, o)}>Mark {NEXT[o.status]}</Button>}
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
    )
  );

  return (
    <RoleGate allowed={["delivery_boy", "admin"]} hasAny={roles.includes("delivery_boy") || roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold">My deliveries</h1>
        <Tabs defaultValue="food" className="mt-6">
          <TabsList>
            <TabsTrigger value="food">Food ({food.length})</TabsTrigger>
            <TabsTrigger value="grocery">Grocery ({grocery.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="food">
            {renderList(food, "food_orders", (o) => o.restaurants?.name ?? "Restaurant", "🍽️")}
          </TabsContent>
          <TabsContent value="grocery">
            {renderList(grocery, "grocery_orders", (o) => o.grocery_stores?.name ?? "Store", "🛒")}
          </TabsContent>
        </Tabs>
      </div>
    </RoleGate>
  );
}
