import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/app/orders")({
  component: MyOrders,
});

type FoodOrder = {
  id: string; status: string; total: number; delivery_address: string; created_at: string;
  rider_id?: string | null; restaurants: { name: string } | null;
};
type GroceryOrder = {
  id: string; status: string; total: number; delivery_address: string; created_at: string;
  rider_id?: string | null; grocery_stores: { name: string } | null;
};
type Ride = {
  id: string; status: string; fare_estimate: number | null; pickup_address: string; drop_address: string;
  created_at: string; rider_id: string | null; vehicle_type: string | null;
};
type Pkg = {
  id: string; status: string; fare_estimate: number | null; pickup_address: string; drop_address: string;
  created_at: string; rider_id: string | null; package_size: string;
};

function statusColor(status: string) {
  switch (status) {
    case "delivered":
    case "completed": return "text-green-600";
    case "cancelled": return "text-red-600";
    case "pending":
    case "requested": return "text-amber-600";
    default: return "text-blue-600";
  }
}

const ACTIVE = (s: string) => s !== "delivered" && s !== "completed" && s !== "cancelled";

function MyOrders() {
  const { user } = useAuth();
  const [food, setFood] = useState<FoodOrder[]>([]);
  const [grocery, setGrocery] = useState<GroceryOrder[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = () => api.orders.getMine().then(({ food, grocery, rides, packages }) => {
      if (!alive) return;
      setFood((food as FoodOrder[]) ?? []);
      setGrocery((grocery as GroceryOrder[]) ?? []);
      setRides((rides as Ride[]) ?? []);
      setPkgs((packages as Pkg[]) ?? []);
      setLoading(false);
    });
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user]);

  const Empty = ({ msg }: { msg: string }) => (
    <p className="mt-6 rounded-2xl border bg-card p-12 text-center text-muted-foreground">{msg}</p>
  );

  const Card = ({
    title, status, sub, meta, amount, trackHref,
  }: {
    title: string; status: string; sub: string; meta: string; amount: string;
    trackHref?: { kind: "food" | "grocery" | "ride" | "package"; id: string };
  }) => (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <span className={`text-sm font-medium ${statusColor(status)}`}>{status}</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{meta}</span>
        <div className="flex items-center gap-2">
          <span className="font-medium">{amount}</span>
          {trackHref && ACTIVE(status) && (
            <Button asChild size="sm" variant="outline">
              <Link to="/app/track" search={{ id: trackHref.id, kind: trackHref.kind }}>Track</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold">My orders</h1>
      {loading ? <p className="mt-4 text-muted-foreground">Loading...</p> : (
        <Tabs defaultValue="food" className="mt-6">
          <TabsList>
            <TabsTrigger value="food">Food ({food.length})</TabsTrigger>
            <TabsTrigger value="grocery">Grocery ({grocery.length})</TabsTrigger>
            <TabsTrigger value="rides">Rides ({rides.length})</TabsTrigger>
            <TabsTrigger value="packages">Packages ({pkgs.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="food">
            {food.length === 0 ? <Empty msg="No food orders yet." /> : (
              <div className="mt-4 space-y-3">
                {food.map((o) => (
                  <Card key={o.id} title={o.restaurants?.name ?? "Restaurant"} status={o.status}
                    sub={o.delivery_address} meta={new Date(o.created_at).toLocaleString()}
                    amount={`₹${Number(o.total).toFixed(0)}`} trackHref={{ kind: "food", id: o.id }} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="grocery">
            {grocery.length === 0 ? <Empty msg="No grocery orders yet." /> : (
              <div className="mt-4 space-y-3">
                {grocery.map((o) => (
                  <Card key={o.id} title={o.grocery_stores?.name ?? "Store"} status={o.status}
                    sub={o.delivery_address} meta={new Date(o.created_at).toLocaleString()}
                    amount={`₹${Number(o.total).toFixed(0)}`} trackHref={{ kind: "grocery", id: o.id }} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rides">
            {rides.length === 0 ? <Empty msg="No rides yet." /> : (
              <div className="mt-4 space-y-3">
                {rides.map((o) => (
                  <Card key={o.id} title={`${(o.vehicle_type ?? "ride").toUpperCase()} ride`} status={o.status}
                    sub={`${o.pickup_address} → ${o.drop_address}`} meta={new Date(o.created_at).toLocaleString()}
                    amount={o.fare_estimate ? `₹${Number(o.fare_estimate).toFixed(0)}` : "—"}
                    trackHref={{ kind: "ride", id: o.id }} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="packages">
            {pkgs.length === 0 ? <Empty msg="No packages yet." /> : (
              <div className="mt-4 space-y-3">
                {pkgs.map((o) => (
                  <Card key={o.id} title={`Package (${o.package_size})`} status={o.status}
                    sub={`${o.pickup_address} → ${o.drop_address}`} meta={new Date(o.created_at).toLocaleString()}
                    amount={o.fare_estimate ? `₹${Number(o.fare_estimate).toFixed(0)}` : "—"}
                    trackHref={{ kind: "package", id: o.id }} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
