import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RoleGate } from "@/components/coming-soon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/delivery/")({
  component: DeliveryAvailable,
});

type FoodOrder = {
  id: string;
  status: string;
  total: number;
  delivery_address: string;
  created_at: string;
  restaurants: { name: string } | null;
};

type GroceryOrder = {
  id: string;
  status: string;
  total: number;
  delivery_address: string;
  created_at: string;
  grocery_stores: { name: string } | null;
};

function DeliveryAvailable() {
  const { user, roles } = useAuth();
  const [food, setFood] = useState<FoodOrder[]>([]);
  const [grocery, setGrocery] = useState<GroceryOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { food: f, grocery: g } = await api.delivery.getAvailable();
    setFood((f as FoodOrder[]) ?? []);
    setGrocery((g as GroceryOrder[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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

  return (
    <RoleGate allowed={["delivery_boy", "admin"]} hasAny={roles.includes("delivery_boy") || roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold">Available deliveries</h1>
        <p className="text-muted-foreground">Pick a job to deliver.</p>

        <Tabs defaultValue="food" className="mt-6">
          <TabsList>
            <TabsTrigger value="food">Food ({food.length})</TabsTrigger>
            <TabsTrigger value="grocery">Grocery ({grocery.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="food">
            {loading ? (
              <p className="mt-4 text-muted-foreground">Loading...</p>
            ) : food.length === 0 ? (
              <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">No food jobs right now.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {food.map((o) => (
                  <div key={o.id} className="rounded-xl border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">🍽️ {o.restaurants?.name ?? "Restaurant"}</h3>
                      <span className="text-xs rounded-full bg-secondary px-2 py-1">{o.status}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">📍 {o.delivery_address}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-medium">${Number(o.total).toFixed(2)}</span>
                      <Button size="sm" onClick={() => acceptFood(o.id)}>Accept</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="grocery">
            {loading ? (
              <p className="mt-4 text-muted-foreground">Loading...</p>
            ) : grocery.length === 0 ? (
              <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">No grocery jobs right now.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {grocery.map((o) => (
                  <div key={o.id} className="rounded-xl border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">🛒 {o.grocery_stores?.name ?? "Store"}</h3>
                      <span className="text-xs rounded-full bg-secondary px-2 py-1">{o.status}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">📍 {o.delivery_address}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-medium">${Number(o.total).toFixed(2)}</span>
                      <Button size="sm" onClick={() => acceptGrocery(o.id)}>Accept</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </RoleGate>
  );
}
