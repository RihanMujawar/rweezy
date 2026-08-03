import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { RoleGate } from "@/components/coming-soon";
import { api } from "@/lib/api";
import { useAlertsPreference } from "@/hooks/use-alerts-preference";
import { distanceKm, type LatLng } from "@/lib/geo";
import {
  Bell,
  BellOff,
  Filter,
  Map as MapIcon,
  History,
  Power,
  IndianRupee,
  Bike,
  Zap,
  Car,
  UtensilsCrossed,
  ShoppingBasket,
  Package as PackageIcon,
  MapPin,
  ClipboardList,
} from "lucide-react";
import { OrdersMap, MapOrder } from "@/components/orders-map";

export const Route = createFileRoute("/_protected/all-in-one-partner/")({
  component: AllInOneDashboard,
});

const MAX_ACCEPT_KM = 5;

type FoodOrder = {
  id: string;
  status: string;
  total: number;
  delivery_address: string;
  delivery_lat?: number;
  delivery_lng?: number;
  pickup_address?: string;
  pickup_lat?: number;
  pickup_lng?: number;
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
  pickup_address?: string;
  pickup_lat?: number;
  pickup_lng?: number;
  created_at: string;
  grocery_stores: { name: string } | null;
  profiles?: { full_name: string; phone: string };
};

type Ride = {
  id: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  drop_address: string;
  drop_lat: number;
  drop_lng: number;
  fare_estimate: number | null;
  status: string;
  created_at: string;
  rider_id: string | null;
  vehicle_type?: string | null;
  profiles?: { full_name: string; phone: string };
};

type Pkg = {
  id: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  drop_address: string;
  drop_lat: number;
  drop_lng: number;
  fare_estimate: number | null;
  status: string;
  created_at: string;
  rider_id: string | null;
  package_size: string;
  receiver_name: string | null;
  profiles?: { full_name: string; phone: string };
};

const VEHICLE_ICON: Record<string, typeof Bike> = { bike: Bike, auto: Zap, car: Car };

function statusColor(status: string) {
  switch (status) {
    case "delivered":
    case "completed":
      return "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-950/30";
    case "cancelled":
      return "text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-950/30";
    default:
      return "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-950/30";
  }
}

function AllInOneDashboard() {
  const { user, roles } = useAuth();
  const [food, setFood] = useState<FoodOrder[]>([]);
  const [grocery, setGrocery] = useState<GroceryOrder[]>([]);
  const [activeFood, setActiveFood] = useState<FoodOrder[]>([]);
  const [activeGrocery, setActiveGrocery] = useState<GroceryOrder[]>([]);

  const [rides, setRides] = useState<Ride[]>([]);
  const [pkgs, setPkgs] = useState<Pkg[]>([]);

  const [historyFood, setHistoryFood] = useState<FoodOrder[]>([]);
  const [historyGrocery, setHistoryGrocery] = useState<GroceryOrder[]>([]);
  const [historyRides, setHistoryRides] = useState<any[]>([]);
  const [historyPkgs, setHistoryPkgs] = useState<any[]>([]);

  const [loc, setLoc] = useState<LatLng | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [acceptingJobs, setAcceptingJobs] = useState(true);
  const { alertsEnabled, setAlertsEnabled } = useAlertsPreference();

  const [minFare, setMinFare] = useState(0);
  const [sortBy, setSortBy] = useState<"distance" | "fare" | "newest">("newest");

  // Track coordinates for distances
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => toast.message("Enable location to see distances and accept jobs"),
      { enableHighAccuracy: true },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  const load = useCallback(async () => {
    if (!user || !acceptingJobs) return;
    try {
      const [deliveryAvail, deliveryActive, riderJobs] = await Promise.all([
        api.delivery.getAvailable(),
        api.delivery.getActive(),
        api.rider.getJobs(),
      ]);

      setFood((deliveryAvail.food as FoodOrder[]) ?? []);
      setGrocery((deliveryAvail.grocery as GroceryOrder[]) ?? []);
      setActiveFood((deliveryActive.food as FoodOrder[]) ?? []);
      setActiveGrocery((deliveryActive.grocery as GroceryOrder[]) ?? []);

      setRides((riderJobs.rides as Ride[]) ?? []);
      setPkgs((riderJobs.packages as Pkg[]) ?? []);

      setLoading(false);
    } catch (error) {
      // fail silently on interval refreshes
    }
  }, [acceptingJobs, user]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const [deliveryHistory, riderHistory] = await Promise.all([
        api.delivery.getHistory(),
        api.rider.getHistory(),
      ]);
      setHistoryFood((deliveryHistory.food as FoodOrder[]) ?? []);
      setHistoryGrocery((deliveryHistory.grocery as GroceryOrder[]) ?? []);
      setHistoryRides((riderHistory.rides as any[]) ?? []);
      setHistoryPkgs((riderHistory.packages as any[]) ?? []);
    } catch (error) {
      toast.error("Failed to load history");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  const acceptFood = async (id: string) => {
    if (!user) return;
    try {
      await api.delivery.accept("food", id);
      toast.success("Food job accepted successfully!");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to accept food job");
    }
  };

  const acceptGrocery = async (id: string) => {
    if (!user) return;
    try {
      await api.delivery.accept("grocery", id);
      toast.success("Grocery job accepted successfully!");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to accept grocery job");
    }
  };

  const acceptRide = async (id: string, pickup: LatLng) => {
    if (!user) return;
    if (!loc) return toast.error("Enable location first");
    const d = distanceKm(loc, pickup);
    if (d > MAX_ACCEPT_KM) {
      return toast.error(`You're ${d.toFixed(1)} km away. Must be within ${MAX_ACCEPT_KM} km.`);
    }
    try {
      await api.rider.acceptRide(id);
      toast.success("Ride job accepted!");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to accept ride");
    }
  };

  const acceptPkg = async (id: string, pickup: LatLng) => {
    if (!user) return;
    if (!loc) return toast.error("Enable location first");
    const d = distanceKm(loc, pickup);
    if (d > MAX_ACCEPT_KM) {
      return toast.error(`You're ${d.toFixed(1)} km away. Must be within ${MAX_ACCEPT_KM} km.`);
    }
    try {
      await api.rider.acceptPackage(id);
      toast.success("Package job accepted!");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to accept package");
    }
  };

  const decline = (label: string) => {
    const reason = window.prompt("Decline reason", "Too far");
    if (reason) toast.message(`${label} hidden for now`, { description: reason });
  };

  // Helper sorting and filtering
  const sortAndFilterJobs = <
    T extends {
      fare_estimate?: number | null;
      total?: number;
      created_at: string;
      pickup_lat?: number;
      pickup_lng?: number;
    },
  >(
    jobs: T[],
  ) => {
    return [...jobs]
      .filter((job) => {
        const amt = Number(job.fare_estimate ?? job.total ?? 0);
        return amt >= minFare;
      })
      .sort((a, b) => {
        const amtA = Number(a.fare_estimate ?? a.total ?? 0);
        const amtB = Number(b.fare_estimate ?? b.total ?? 0);
        if (sortBy === "fare") return amtB - amtA;
        if (sortBy === "newest") {
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }
        if (!loc || a.pickup_lat === undefined || b.pickup_lat === undefined) return 0;
        return (
          distanceKm(loc, { lat: a.pickup_lat, lng: a.pickup_lng || 0 }) -
          distanceKm(loc, { lat: b.pickup_lat, lng: b.pickup_lng || 0 })
        );
      });
  };

  const availableRides = acceptingJobs ? sortAndFilterJobs(rides.filter((r) => !r.rider_id)) : [];
  const myRides = rides.filter((r) => r.rider_id === user?.id);

  const availablePkgs = acceptingJobs ? sortAndFilterJobs(pkgs.filter((r) => !r.rider_id)) : [];
  const myPkgs = pkgs.filter((r) => r.rider_id === user?.id);

  const availableFood = acceptingJobs ? sortAndFilterJobs(food) : [];
  const availableGrocery = acceptingJobs ? sortAndFilterJobs(grocery) : [];

  const mapOrders: MapOrder[] = [
    ...availableFood.map((o) => ({
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
    ...availableGrocery.map((o) => ({
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
    ...availableRides.map((o) => ({
      id: o.id,
      lat: o.drop_lat || 0,
      lng: o.drop_lng || 0,
      pickupLat: o.pickup_lat,
      pickupLng: o.pickup_lng,
      customerName: o.profiles?.full_name,
      customerPhone: o.profiles?.phone,
      status: o.status,
      total: o.fare_estimate || 0,
      type: "ride" as const,
      canAccept: true,
    })),
    ...availablePkgs.map((o) => ({
      id: o.id,
      lat: o.drop_lat || 0,
      lng: o.drop_lng || 0,
      pickupLat: o.pickup_lat,
      pickupLng: o.pickup_lng,
      customerName: o.profiles?.full_name,
      customerPhone: o.profiles?.phone,
      status: o.status,
      total: o.fare_estimate || 0,
      type: "package" as const,
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
    else if (type === "ride") {
      const item = rides.find((r) => r.id === id);
      if (item) await acceptRide(id, { lat: item.pickup_lat, lng: item.pickup_lng });
    } else if (type === "package") {
      const item = pkgs.find((r) => r.id === id);
      if (item) await acceptPkg(id, { lat: item.pickup_lat, lng: item.pickup_lng });
    }
  };

  const distLabel = (p?: { lat?: number; lng?: number }) => {
    if (!loc || !p || p.lat === undefined || p.lng === undefined) return "—";
    return `${distanceKm(loc, { lat: p.lat, lng: p.lng }).toFixed(1)} km away`;
  };

  return (
    <RoleGate
      allowed={["all_in_one_partner", "admin"]}
      hasAny={roles.includes("all_in_one_partner") || roles.includes("admin")}
    >
      <div className="container mx-auto px-4 py-8 animate-fade-in-up">
        {/* Dashboard Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Truck className="h-6 w-6 text-primary" />
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight">All-in-One Dashboard</h1>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Universal Agent Control. Instantly accept and process Food, Grocery, Rides and
              Packages in your area.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={acceptingJobs ? "default" : "outline"}
              className="min-h-11"
              onClick={() => setAcceptingJobs((val) => !val)}
            >
              <Power className="mr-2 h-4 w-4" /> {acceptingJobs ? "Online" : "Paused"}
            </Button>
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
              {alertsEnabled ? "Alerts On" : "Alerts Off"}
            </Button>
          </div>
        </div>

        {/* Global Filter Bar */}
        <div className="mt-6 grid gap-3 rounded-xl border bg-card/60 p-4 md:grid-cols-3 backdrop-blur-xl">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Filter className="h-4 w-4 text-primary" /> Filter & Sort Jobs
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Minimum Fare (₹)</Label>
            <Input
              type="number"
              value={minFare}
              onChange={(e) => setMinFare(Number(e.target.value))}
              placeholder="Minimum Fare"
              className="mt-1 min-h-11"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Sort By</Label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="mt-1 flex h-11 w-full rounded-md border bg-background px-3 text-sm focus:outline-none"
            >
              <option value="newest">Newest First</option>
              <option value="fare">Highest Fare</option>
              <option value="distance">Nearest Pickup</option>
            </select>
          </div>
        </div>

        {/* Core Content Tabs */}
        <Tabs defaultValue="jobs" className="mt-8">
          <TabsList className="grid w-full grid-cols-3 max-w-md">
            <TabsTrigger value="jobs">
              <MapIcon className="mr-2 h-4 w-4" /> Available (
              {availableFood.length +
                availableGrocery.length +
                availableRides.length +
                availablePkgs.length}
              )
            </TabsTrigger>
            <TabsTrigger value="active">
              <ClipboardList className="mr-2 h-4 w-4" /> Active (
              {activeFood.length + activeGrocery.length + myRides.length + myPkgs.length})
            </TabsTrigger>
            <TabsTrigger value="history" onClick={loadHistory}>
              <History className="mr-2 h-4 w-4" /> History
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: AVAILABLE JOBS */}
          <TabsContent value="jobs" className="space-y-6">
            <div className="mt-4 rounded-2xl border overflow-hidden">
              <OrdersMap orders={mapOrders} onAccept={handleAccept} height={500} />
            </div>

            <Tabs defaultValue="food" className="mt-6">
              <TabsList className="flex flex-wrap gap-2">
                <TabsTrigger value="food">🍽️ Food ({availableFood.length})</TabsTrigger>
                <TabsTrigger value="grocery">🛒 Grocery ({availableGrocery.length})</TabsTrigger>
                <TabsTrigger value="rides">🏍️ Rides ({availableRides.length})</TabsTrigger>
                <TabsTrigger value="packages">📦 Packages ({availablePkgs.length})</TabsTrigger>
              </TabsList>

              {/* Food Jobs */}
              <TabsContent value="food" className="mt-4">
                {availableFood.length === 0 ? (
                  <p className="rounded-2xl border border-dashed bg-card/40 p-12 text-center text-muted-foreground">
                    No food delivery jobs available in your area.
                  </p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {availableFood.map((o) => (
                      <div
                        key={o.id}
                        className="rounded-2xl border bg-card/60 p-5 shadow-sm backdrop-blur-xl"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                              Food Delivery
                            </span>
                            <h3 className="mt-1 font-bold text-lg">
                              🍽️ {o.restaurants?.name || "Restaurant"}
                            </h3>
                          </div>
                          <Badge variant="secondary" className="capitalize">
                            {o.status}
                          </Badge>
                        </div>
                        <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
                          📍 {o.delivery_address}
                        </p>
                        {o.pickup_lat !== undefined && (
                          <p className="mt-1 text-xs text-muted-foreground font-medium">
                            📏 Distance: {distLabel({ lat: o.pickup_lat, lng: o.pickup_lng })}
                          </p>
                        )}
                        <div className="mt-4 flex items-center justify-between border-t pt-4">
                          <span className="text-lg font-black">₹{Number(o.total).toFixed(0)}</span>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => acceptFood(o.id)}>
                              Accept
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => decline("Food Job")}>
                              Decline
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Grocery Jobs */}
              <TabsContent value="grocery" className="mt-4">
                {availableGrocery.length === 0 ? (
                  <p className="rounded-2xl border border-dashed bg-card/40 p-12 text-center text-muted-foreground">
                    No grocery delivery jobs available in your area.
                  </p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {availableGrocery.map((o) => (
                      <div
                        key={o.id}
                        className="rounded-2xl border bg-card/60 p-5 shadow-sm backdrop-blur-xl"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                              Grocery Delivery
                            </span>
                            <h3 className="mt-1 font-bold text-lg">
                              🛒 {o.grocery_stores?.name || "Store"}
                            </h3>
                          </div>
                          <Badge variant="secondary" className="capitalize">
                            {o.status}
                          </Badge>
                        </div>
                        <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
                          📍 {o.delivery_address}
                        </p>
                        {o.pickup_lat !== undefined && (
                          <p className="mt-1 text-xs text-muted-foreground font-medium">
                            📏 Distance: {distLabel({ lat: o.pickup_lat, lng: o.pickup_lng })}
                          </p>
                        )}
                        <div className="mt-4 flex items-center justify-between border-t pt-4">
                          <span className="text-lg font-black">₹{Number(o.total).toFixed(0)}</span>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => acceptGrocery(o.id)}>
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => decline("Grocery Job")}
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

              {/* Rides Jobs */}
              <TabsContent value="rides" className="mt-4">
                {availableRides.length === 0 ? (
                  <p className="rounded-2xl border border-dashed bg-card/40 p-12 text-center text-muted-foreground">
                    No ride requests available in your area.
                  </p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {availableRides.map((o) => {
                      const Icon = VEHICLE_ICON[o.vehicle_type ?? "bike"] || Bike;
                      return (
                        <div
                          key={o.id}
                          className="rounded-2xl border bg-card/60 p-5 shadow-sm backdrop-blur-xl"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                                Ride Request
                              </span>
                              <div className="flex items-center gap-2 mt-1">
                                <Icon className="h-5 w-5 text-foreground" />
                                <h3 className="font-bold text-lg uppercase">
                                  {o.vehicle_type || "Bike"}
                                </h3>
                              </div>
                            </div>
                            <Badge variant="secondary" className="capitalize">
                              {o.status}
                            </Badge>
                          </div>
                          <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                            <p className="line-clamp-1">
                              <span className="text-green-500 font-bold">●</span> {o.pickup_address}
                            </p>
                            <p className="line-clamp-1">
                              <span className="text-red-500 font-bold">●</span> {o.drop_address}
                            </p>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground font-medium">
                            📏 Distance: {distLabel({ lat: o.pickup_lat, lng: o.pickup_lng })}
                          </p>
                          <div className="mt-4 flex items-center justify-between border-t pt-4">
                            <span className="text-lg font-black">
                              ₹{Number(o.fare_estimate || 0).toFixed(0)}
                            </span>
                            <Button
                              size="sm"
                              onClick={() =>
                                acceptRide(o.id, { lat: o.pickup_lat, lng: o.pickup_lng })
                              }
                            >
                              Accept Ride
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              {/* Packages Jobs */}
              <TabsContent value="packages" className="mt-4">
                {availablePkgs.length === 0 ? (
                  <p className="rounded-2xl border border-dashed bg-card/40 p-12 text-center text-muted-foreground">
                    No package delivery requests in your area.
                  </p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {availablePkgs.map((o) => (
                      <div
                        key={o.id}
                        className="rounded-2xl border bg-card/60 p-5 shadow-sm backdrop-blur-xl"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                              Package Dispatch
                            </span>
                            <div className="flex items-center gap-2 mt-1">
                              <PackageIcon className="h-5 w-5 text-foreground" />
                              <h3 className="font-bold text-lg uppercase">
                                {o.package_size || "Small"} size
                              </h3>
                            </div>
                          </div>
                          <Badge variant="secondary" className="capitalize">
                            {o.status}
                          </Badge>
                        </div>
                        <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                          <p className="line-clamp-1">
                            <span className="text-green-500 font-bold">●</span> {o.pickup_address}
                          </p>
                          <p className="line-clamp-1">
                            <span className="text-red-500 font-bold">●</span> {o.drop_address}
                          </p>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground font-medium">
                          📏 Distance: {distLabel({ lat: o.pickup_lat, lng: o.pickup_lng })}
                        </p>
                        <div className="mt-4 flex items-center justify-between border-t pt-4">
                          <span className="text-lg font-black">
                            ₹{Number(o.fare_estimate || 0).toFixed(0)}
                          </span>
                          <Button
                            size="sm"
                            onClick={() =>
                              acceptPkg(o.id, { lat: o.pickup_lat, lng: o.pickup_lng })
                            }
                          >
                            Accept Delivery
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* TAB 2: ACTIVE JOBS */}
          <TabsContent value="active" className="space-y-6">
            {activeFood.length === 0 &&
            activeGrocery.length === 0 &&
            myRides.length === 0 &&
            myPkgs.length === 0 ? (
              <p className="rounded-2xl border border-dashed bg-card/40 p-12 text-center text-muted-foreground">
                No active/assigned jobs right now. Go online and accept a job from the "Available"
                tab!
              </p>
            ) : (
              <div className="space-y-4">
                {/* Active Deliveries (Food / Grocery) */}
                {[...activeFood, ...activeGrocery].map((o) => {
                  const isFood = "restaurants" in o;
                  return (
                    <div
                      key={o.id}
                      className="rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-lg"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <Badge variant="default" className="mb-2">
                            {isFood ? "🍽️ Active Food Job" : "🛒 Active Grocery Job"}
                          </Badge>
                          <h3 className="font-bold text-lg">
                            {isFood ? o.restaurants?.name : o.grocery_stores?.name}
                          </h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            📍 {o.delivery_address}
                          </p>
                        </div>
                        <Button asChild size="sm">
                          <Link to="/delivery/active">Open Control</Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {/* Active Rides */}
                {myRides.map((o) => (
                  <div
                    key={o.id}
                    className="rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-lg"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <Badge variant="default" className="mb-2">
                          🏍️ Active Ride Job
                        </Badge>
                        <h3 className="font-bold text-lg">
                          Passenger: {o.profiles?.full_name || "User"}
                        </h3>
                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                          <p>
                            <span className="text-green-500 font-bold">●</span> {o.pickup_address}
                          </p>
                          <p>
                            <span className="text-red-500 font-bold">●</span> {o.drop_address}
                          </p>
                        </div>
                      </div>
                      <Button asChild size="sm">
                        <Link to="/rider/active" search={{ id: o.id }}>
                          Open Control
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}

                {/* Active Packages */}
                {myPkgs.map((o) => (
                  <div
                    key={o.id}
                    className="rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-lg"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <Badge variant="default" className="mb-2">
                          📦 Active Package Job
                        </Badge>
                        <h3 className="font-bold text-lg">Receiver: {o.receiver_name || "User"}</h3>
                        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                          <p>
                            <span className="text-green-500 font-bold">●</span> {o.pickup_address}
                          </p>
                          <p>
                            <span className="text-red-500 font-bold">●</span> {o.drop_address}
                          </p>
                        </div>
                      </div>
                      <Button asChild size="sm">
                        <Link to="/rider/active" search={{ id: o.id, kind: "package" }}>
                          Open Control
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* TAB 3: HISTORY */}
          <TabsContent value="history" className="space-y-6">
            {loadingHistory ? (
              <p className="text-muted-foreground">Loading history...</p>
            ) : (
              <div className="space-y-4">
                {/* Completed Deliveries (Food & Grocery) */}
                {[...historyFood, ...historyGrocery].map((o) => {
                  const isFood = "restaurants" in o;
                  return (
                    <div key={o.id} className="rounded-2xl border bg-card/60 p-4 backdrop-blur-xl">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold">
                          {isFood
                            ? `🍽️ ${o.restaurants?.name || "Food"}`
                            : `🛒 ${o.grocery_stores?.name || "Grocery"}`}
                        </h4>
                        <Badge className={statusColor(o.status)} variant="secondary">
                          {o.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">📍 {o.delivery_address}</p>
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-bold text-sm text-foreground">
                          ₹{Number(o.total).toFixed(0)}
                        </span>
                        <span>{new Date(o.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  );
                })}

                {/* Completed Rides */}
                {historyRides.map((o) => (
                  <div key={o.id} className="rounded-2xl border bg-card/60 p-4 backdrop-blur-xl">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold">🏍️ Ride Trip</h4>
                      <Badge className={statusColor(o.status)} variant="secondary">
                        {o.status}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                      <p>
                        <span className="text-green-500">●</span> {o.pickup_address}
                      </p>
                      <p>
                        <span className="text-red-500">●</span> {o.drop_address}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-bold text-sm text-foreground">
                        ₹{Number(o.fare_estimate || 0).toFixed(0)}
                      </span>
                      <span>{new Date(o.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}

                {/* Completed Packages */}
                {historyPkgs.map((o) => (
                  <div key={o.id} className="rounded-2xl border bg-card/60 p-4 backdrop-blur-xl">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold">📦 Package Delivery</h4>
                      <Badge className={statusColor(o.status)} variant="secondary">
                        {o.status}
                      </Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground space-y-1">
                      <p>
                        <span className="text-green-500">●</span> {o.pickup_address}
                      </p>
                      <p>
                        <span className="text-red-500">●</span> {o.drop_address}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-bold text-sm text-foreground">
                        ₹{Number(o.fare_estimate || 0).toFixed(0)}
                      </span>
                      <span>{new Date(o.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}

                {historyFood.length === 0 &&
                  historyGrocery.length === 0 &&
                  historyRides.length === 0 &&
                  historyPkgs.length === 0 && (
                    <p className="rounded-2xl border border-dashed bg-card/40 p-12 text-center text-muted-foreground">
                      No completed jobs found in your history.
                    </p>
                  )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </RoleGate>
  );
}
