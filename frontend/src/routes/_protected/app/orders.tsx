import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  ClipboardList,
  MessageCircle,
  MoreHorizontal,
  RefreshCcw,
  ShoppingBag,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

export const Route = createFileRoute("/_protected/app/orders")({
  component: MyOrders,
});

type FoodOrder = {
  id: string;
  status: string;
  total: number;
  delivery_address: string;
  created_at: string;
  rider_id?: string | null;
  restaurants: { name: string } | null;
};
type GroceryOrder = {
  id: string;
  status: string;
  total: number;
  delivery_address: string;
  created_at: string;
  rider_id?: string | null;
  grocery_stores: { name: string } | null;
};
type Ride = {
  id: string;
  status: string;
  fare_estimate: number | null;
  pickup_address: string;
  drop_address: string;
  created_at: string;
  rider_id: string | null;
  vehicle_type: string | null;
};
type Pkg = {
  id: string;
  status: string;
  fare_estimate: number | null;
  pickup_address: string;
  drop_address: string;
  created_at: string;
  rider_id: string | null;
  package_size: string;
};

function statusBadgeClass(status: string) {
  switch (status) {
    case "pending":
    case "requested":
      return "border-gray-200 bg-gray-100 text-gray-700";
    case "accepted":
    case "assigned":
      return "border-blue-200 bg-blue-100 text-blue-700";
    case "preparing":
    case "picked_up":
    case "in_progress":
      return "border-orange-200 bg-orange-100 text-orange-700";
    case "ready":
    case "on_the_way":
      return "border-green-200 bg-green-100 text-green-700";
    case "delivered":
    case "completed":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    case "cancelled":
      return "border-red-200 bg-red-100 text-red-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
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
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusSnapshot = useRef<Map<string, string>>(new Map());
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = async () => {
      try {
        const { food, grocery, rides, packages } = await api.orders.getMine();
        if (!alive) return;
        const nextFood = (food as FoodOrder[]) ?? [];
        const nextGrocery = (grocery as GroceryOrder[]) ?? [];
        const nextRides = (rides as Ride[]) ?? [];
        const nextPkgs = (packages as Pkg[]) ?? [];
        const nextSnapshot = new Map<string, string>();
        [
          ...nextFood.map((order) => [`food:${order.id}`, order.status, "Food order"] as const),
          ...nextGrocery.map(
            (order) => [`grocery:${order.id}`, order.status, "Grocery order"] as const,
          ),
          ...nextRides.map((order) => [`ride:${order.id}`, order.status, "Ride"] as const),
          ...nextPkgs.map((order) => [`package:${order.id}`, order.status, "Package"] as const),
        ].forEach(([key, status, label]) => {
          nextSnapshot.set(key, status);
          const previous = statusSnapshot.current.get(key);
          if (previous && previous !== status) toast.info(`${label} is now ${status}`);
        });
        statusSnapshot.current = nextSnapshot;
        setFood(nextFood);
        setGrocery(nextGrocery);
        setRides(nextRides);
        setPkgs(nextPkgs);
        setError(null);
      } catch (error) {
        if (!alive) return;
        setError(error instanceof Error ? error.message : "Failed to refresh orders");
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user]);

  const Empty = ({
    msg,
    cta,
    to,
  }: {
    msg: string;
    cta: string;
    to: "/app/food" | "/app/grocery" | "/app/ride" | "/app/package";
  }) => (
    <div className="mt-6 rounded-lg border bg-card p-8 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <ShoppingBag className="h-8 w-8 text-primary" />
      </div>
      <p className="mt-3 font-medium">{msg}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Your new orders will appear here as they move.
      </p>
      <Button asChild className="mt-4 min-h-11">
        <Link to={to}>{cta}</Link>
      </Button>
    </div>
  );

  const cancel = async (kind: "food" | "grocery" | "ride" | "package", id: string) => {
    const reason = window.prompt("Reason for cancellation?", "Changed my mind");
    if (reason === null) return;
    setCancelling(id);
    try {
      await api.orders.cancel(kind, id, reason);
      toast.success("Cancelled");
      const data = await api.orders.getMine();
      setFood((data.food as FoodOrder[]) ?? []);
      setGrocery((data.grocery as GroceryOrder[]) ?? []);
      setRides((data.rides as Ride[]) ?? []);
      setPkgs((data.packages as Pkg[]) ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel");
    } finally {
      setCancelling(null);
    }
  };

  const Card = ({
    title,
    status,
    sub,
    meta,
    amount,
    trackHref,
    reorderHref,
  }: {
    title: string;
    status: string;
    sub: string;
    meta: string;
    amount: string;
    trackHref?: { kind: "food" | "grocery" | "ride" | "package"; id: string };
    reorderHref?: "/app/food" | "/app/grocery" | "/app/ride" | "/app/package";
  }) => (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <Badge variant="outline" className={statusBadgeClass(status)}>
          {status.replaceAll("_", " ")}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{meta}</span>
        <div className="flex items-center gap-2">
          <span className="font-medium">{amount}</span>
          {isMobile && trackHref ? (
            <Drawer>
              <DrawerTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-11 w-11"
                  aria-label="Order actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>Order actions</DrawerTitle>
                </DrawerHeader>
                <DrawerFooter>
                  {ACTIVE(status) && (
                    <Button asChild className="min-h-11">
                      <Link to="/app/track" search={{ id: trackHref.id, kind: trackHref.kind }}>
                        <ClipboardList className="mr-2 h-4 w-4" /> Track
                      </Link>
                    </Button>
                  )}
                  {ACTIVE(status) && (
                    <Button asChild variant="outline" className="min-h-11">
                      <Link to="/app/track" search={{ id: trackHref.id, kind: trackHref.kind }}>
                        <MessageCircle className="mr-2 h-4 w-4" /> Chat
                      </Link>
                    </Button>
                  )}
                  {reorderHref && (
                    <Button asChild variant="outline" className="min-h-11">
                      <Link to={reorderHref}>
                        <RefreshCcw className="mr-2 h-4 w-4" /> Reorder
                      </Link>
                    </Button>
                  )}
                  {ACTIVE(status) && (
                    <Button
                      variant="outline"
                      className="min-h-11"
                      disabled={cancelling === trackHref.id}
                      onClick={() => cancel(trackHref.kind, trackHref.id)}
                    >
                      Cancel
                    </Button>
                  )}
                  <DrawerClose asChild>
                    <Button variant="ghost" className="min-h-11">
                      Close
                    </Button>
                  </DrawerClose>
                </DrawerFooter>
              </DrawerContent>
            </Drawer>
          ) : (
            <>
              {trackHref && ACTIVE(status) && (
                <Button asChild size="sm" variant="outline" className="min-h-11">
                  <Link to="/app/track" search={{ id: trackHref.id, kind: trackHref.kind }}>
                    Track
                  </Link>
                </Button>
              )}
              {trackHref && ACTIVE(status) && (
                <Button asChild size="sm" variant="outline" className="min-h-11">
                  <Link to="/app/track" search={{ id: trackHref.id, kind: trackHref.kind }}>
                    Chat
                  </Link>
                </Button>
              )}
              {reorderHref && (
                <Button asChild size="sm" variant="outline" className="min-h-11">
                  <Link to={reorderHref}>Reorder</Link>
                </Button>
              )}
              {trackHref && ACTIVE(status) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  disabled={cancelling === trackHref.id}
                  onClick={() => cancel(trackHref.kind, trackHref.id)}
                >
                  Cancel
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {ACTIVE(status) && (
        <p className="mt-3 text-xs text-muted-foreground">
          Cancellation is available before pickup or trip start.
        </p>
      )}
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold">My orders</h1>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {loading ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-10 w-full max-w-md" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <Tabs defaultValue="food" className="mt-6">
          <TabsList>
            <TabsTrigger value="food">Food ({food.length})</TabsTrigger>
            <TabsTrigger value="grocery">Grocery ({grocery.length})</TabsTrigger>
            <TabsTrigger value="rides">Rides ({rides.length})</TabsTrigger>
            <TabsTrigger value="packages">Packages ({pkgs.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="food">
            {food.length === 0 ? (
              <Empty msg="No food orders yet." cta="Start shopping" to="/app/food" />
            ) : (
              <div className="mt-4 space-y-3">
                {food.map((o) => (
                  <Card
                    key={o.id}
                    title={o.restaurants?.name ?? "Restaurant"}
                    status={o.status}
                    sub={o.delivery_address}
                    meta={new Date(o.created_at).toLocaleString()}
                    amount={`₹${Number(o.total).toFixed(0)}`}
                    trackHref={{ kind: "food", id: o.id }}
                    reorderHref="/app/food"
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="grocery">
            {grocery.length === 0 ? (
              <Empty msg="No grocery orders yet." cta="Start shopping" to="/app/grocery" />
            ) : (
              <div className="mt-4 space-y-3">
                {grocery.map((o) => (
                  <Card
                    key={o.id}
                    title={o.grocery_stores?.name ?? "Store"}
                    status={o.status}
                    sub={o.delivery_address}
                    meta={new Date(o.created_at).toLocaleString()}
                    amount={`₹${Number(o.total).toFixed(0)}`}
                    trackHref={{ kind: "grocery", id: o.id }}
                    reorderHref="/app/grocery"
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="rides">
            {rides.length === 0 ? (
              <Empty msg="No rides yet." cta="Book a ride" to="/app/ride" />
            ) : (
              <div className="mt-4 space-y-3">
                {rides.map((o) => (
                  <Card
                    key={o.id}
                    title={`${(o.vehicle_type ?? "ride").toUpperCase()} ride`}
                    status={o.status}
                    sub={`${o.pickup_address} → ${o.drop_address}`}
                    meta={new Date(o.created_at).toLocaleString()}
                    amount={o.fare_estimate ? `₹${Number(o.fare_estimate).toFixed(0)}` : "—"}
                    trackHref={{ kind: "ride", id: o.id }}
                    reorderHref="/app/ride"
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="packages">
            {pkgs.length === 0 ? (
              <Empty msg="No packages yet." cta="Send a package" to="/app/package" />
            ) : (
              <div className="mt-4 space-y-3">
                {pkgs.map((o) => (
                  <Card
                    key={o.id}
                    title={`Package (${o.package_size})`}
                    status={o.status}
                    sub={`${o.pickup_address} → ${o.drop_address}`}
                    meta={new Date(o.created_at).toLocaleString()}
                    amount={o.fare_estimate ? `₹${Number(o.fare_estimate).toFixed(0)}` : "—"}
                    trackHref={{ kind: "package", id: o.id }}
                    reorderHref="/app/package"
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
