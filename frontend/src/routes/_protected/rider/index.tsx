import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { RoleGate } from "@/components/coming-soon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { distanceKm, type LatLng } from "@/lib/geo";
import { toast } from "sonner";
import {
  Bike,
  Car,
  Zap,
  MapPin,
  Package as PackageIcon,
  History,
  Power,
  IndianRupee,
  Map as MapIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { OrdersMap, MapOrder } from "@/components/orders-map";

export const Route = createFileRoute("/_protected/rider/")({
  component: RiderList,
});

const MAX_ACCEPT_KM = 5;

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

type HistoryRide = {
  id: string;
  pickup_address: string;
  drop_address: string;
  fare_estimate: number | null;
  status: string;
  created_at: string;
  vehicle_type?: string | null;
};

type HistoryPackage = {
  id: string;
  pickup_address: string;
  drop_address: string;
  fare_estimate: number | null;
  status: string;
  created_at: string;
  package_size: string;
};

const VEHICLE_ICON: Record<string, typeof Bike> = { bike: Bike, auto: Zap, car: Car };

function statusColor(status: string) {
  switch (status) {
    case "delivered":
    case "completed":
      return "text-green-600 bg-green-100";
    case "cancelled":
      return "text-red-600 bg-red-100";
    default:
      return "text-blue-600 bg-blue-100";
  }
}

function RiderList() {
  const { user, roles } = useAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [historyRides, setHistoryRides] = useState<HistoryRide[]>([]);
  const [historyPkgs, setHistoryPkgs] = useState<HistoryPackage[]>([]);
  const [loc, setLoc] = useState<LatLng | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [acceptingJobs, setAcceptingJobs] = useState(true);
  const [minFare, setMinFare] = useState(0);
  const [sortBy, setSortBy] = useState<"distance" | "fare" | "newest">("distance");

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => toast.message("Enable location to accept nearby rides"),
      { enableHighAccuracy: true },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  const load = useCallback(async () => {
    if (!user || !acceptingJobs) return;
    const { rides: r, packages: p } = await api.rider.getJobs();
    setRides((r as Ride[]) ?? []);
    setPkgs((p as Pkg[]) ?? []);
    setLoading(false);
  }, [acceptingJobs, user]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { rides: r, packages: p } = await api.rider.getHistory();
      setHistoryRides((r as HistoryRide[]) ?? []);
      setHistoryPkgs((p as HistoryPackage[]) ?? []);
    } catch (error) {
      toast.error("Failed to load history");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (user) loadHistory();
  }, [loadHistory, user]);

  const acceptRide = async (id: string, pickup: LatLng) => {
    if (!user) return;
    if (!loc) return toast.error("Enable location first");
    const d = distanceKm(loc, pickup);
    if (d > MAX_ACCEPT_KM)
      return toast.error(`You're ${d.toFixed(1)} km away. Must be within ${MAX_ACCEPT_KM} km.`);
    try {
      await api.rider.acceptRide(id);
      toast.success("Ride accepted!");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to accept ride");
    }
  };

  const acceptPkg = async (id: string, pickup: LatLng) => {
    if (!user) return;
    if (!loc) return toast.error("Enable location first");
    const d = distanceKm(loc, pickup);
    if (d > MAX_ACCEPT_KM)
      return toast.error(`You're ${d.toFixed(1)} km away. Must be within ${MAX_ACCEPT_KM} km.`);
    try {
      await api.rider.acceptPackage(id);
      toast.success("Package accepted!");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to accept package");
    }
  };

  const sortJobs = <
    T extends {
      fare_estimate: number | null;
      created_at: string;
      pickup_lat: number;
      pickup_lng: number;
    },
  >(
    jobs: T[],
  ) =>
    [...jobs]
      .filter((job) => Number(job.fare_estimate ?? 0) >= minFare)
      .sort((a, b) => {
        if (sortBy === "fare") return Number(b.fare_estimate ?? 0) - Number(a.fare_estimate ?? 0);
        if (sortBy === "newest")
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (!loc) return 0;
        return (
          distanceKm(loc, { lat: a.pickup_lat, lng: a.pickup_lng }) -
          distanceKm(loc, { lat: b.pickup_lat, lng: b.pickup_lng })
        );
      });

  const availableRides = acceptingJobs ? sortJobs(rides.filter((r) => !r.rider_id)) : [];
  const myRides = rides.filter((r) => r.rider_id === user?.id);
  const availablePkgs = acceptingJobs ? sortJobs(pkgs.filter((r) => !r.rider_id)) : [];
  const myPkgs = pkgs.filter((r) => r.rider_id === user?.id);

  const mapOrders: MapOrder[] = [
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
    ...myRides.map((o) => ({
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
      canAccept: false,
    })),
    ...myPkgs.map((o) => ({
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
      canAccept: false,
    })),
  ].filter((o) => o.lat !== 0);

  const handleAccept = async (id: string, type: MapOrder["type"]) => {
    const order = [...rides, ...pkgs].find((o) => o.id === id);
    if (!order) return;
    if (type === "ride") await acceptRide(id, { lat: order.pickup_lat, lng: order.pickup_lng });
    else if (type === "package")
      await acceptPkg(id, { lat: order.pickup_lat, lng: order.pickup_lng });
  };
  const todayHistory = [...historyRides, ...historyPkgs].filter(
    (job) => new Date(job.created_at).toDateString() === new Date().toDateString(),
  );
  const todayEarnings = todayHistory.reduce((sum, job) => sum + Number(job.fare_estimate ?? 0), 0);

  const distLabel = (p: LatLng) => (loc ? `${distanceKm(loc, p).toFixed(1)} km away` : "—");

  const renderHistoryRides = (list: HistoryRide[]) =>
    list.length === 0 ? (
      <p className="rounded-2xl border bg-card p-12 text-center text-muted-foreground">
        <History className="mx-auto mb-2 h-8 w-8" />
        No ride history yet.
      </p>
    ) : (
      <div className="space-y-3">
        {list.map((r) => {
          const Icon = VEHICLE_ICON[r.vehicle_type ?? "bike"] ?? Bike;
          return (
            <div key={r.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge className={statusColor(r.status)}>{r.status}</Badge>
                    <Icon className="h-4 w-4" />
                    <span className="text-xs uppercase">{r.vehicle_type}</span>
                    {r.fare_estimate && (
                      <span className="text-sm font-semibold">
                        ₹{Number(r.fare_estimate).toFixed(0)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 space-y-1 text-sm">
                    <p>
                      <span className="text-green-600">●</span> {r.pickup_address}
                    </p>
                    <p>
                      <span className="text-red-600">●</span> {r.drop_address}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );

  const renderHistoryPackages = (list: HistoryPackage[]) =>
    list.length === 0 ? (
      <p className="rounded-2xl border bg-card p-12 text-center text-muted-foreground">
        <History className="mx-auto mb-2 h-8 w-8" />
        No package history yet.
      </p>
    ) : (
      <div className="space-y-3">
        {list.map((r) => (
          <div key={r.id} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Badge className={statusColor(r.status)}>{r.status}</Badge>
                  <PackageIcon className="h-4 w-4" />
                  <span className="text-xs uppercase">{r.package_size}</span>
                  {r.fare_estimate && (
                    <span className="text-sm font-semibold">
                      ₹{Number(r.fare_estimate).toFixed(0)}
                    </span>
                  )}
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <p>
                    <span className="text-green-600">●</span> {r.pickup_address}
                  </p>
                  <p>
                    <span className="text-red-600">●</span> {r.drop_address}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    );

  return (
    <RoleGate
      allowed={["rider", "admin", "all_in_one_partner"]}
      hasAny={roles.includes("rider") || roles.includes("admin") || roles.includes("all_in_one_partner")}
    >
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-2">
          <Bike className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Rider dashboard</h1>
        </div>
        {!loc && (
          <p className="mt-2 text-xs text-amber-600">
            Enable browser location to see distances and accept rides.
          </p>
        )}

        <div className="mt-6 grid gap-3 rounded-lg border bg-card p-4 md:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Accepting</p>
            <Button
              variant={acceptingJobs ? "default" : "outline"}
              className="mt-2 min-h-11"
              onClick={() => setAcceptingJobs((value) => !value)}
            >
              <Power className="mr-2 h-4 w-4" /> {acceptingJobs ? "Online" : "Paused"}
            </Button>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Today earnings</p>
            <p className="mt-2 flex items-center text-2xl font-bold">
              <IndianRupee className="h-5 w-5" />
              {todayEarnings.toFixed(0)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Minimum fare</p>
            <Input
              type="number"
              value={minFare}
              onChange={(event) => setMinFare(Number(event.target.value))}
              className="mt-2 min-h-11"
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Sort jobs</p>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as "distance" | "fare" | "newest")}
              className="mt-2 min-h-11 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="distance">Nearest pickup</option>
              <option value="fare">Highest fare</option>
              <option value="newest">Newest first</option>
            </select>
          </div>
        </div>

        <Tabs defaultValue="orders" className="mt-6">
          <TabsList className="flex-wrap">
            <TabsTrigger value="orders">
              <MapIcon className="mr-2 h-4 w-4" /> Orders
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="mr-2 h-4 w-4" /> History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orders">
            <div className="mt-4 space-y-6">
              <OrdersMap orders={mapOrders} onAccept={handleAccept} height={600} />

              <Tabs defaultValue="rides">
                <TabsList className="flex-wrap">
                  <TabsTrigger value="rides">
                    Rides ({availableRides.length + myRides.length})
                  </TabsTrigger>
                  <TabsTrigger value="packages">
                    Packages ({availablePkgs.length + myPkgs.length})
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="rides" className="mt-4 space-y-6">
            {myRides.length > 0 && (
              <section>
                <h2 className="mb-2 text-lg font-semibold">Your active ride</h2>
                {myRides.map((r) => {
                  const Icon = VEHICLE_ICON[r.vehicle_type ?? "bike"] ?? Bike;
                  return (
                    <div key={r.id} className="rounded-xl border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge>{r.status}</Badge>
                            {r.profiles?.full_name && (
                              <span className="text-xs font-semibold">{r.profiles.full_name}</span>
                            )}
                            <Icon className="h-4 w-4" />
                            <span className="text-xs uppercase">{r.vehicle_type}</span>
                            {r.fare_estimate && (
                              <span className="text-sm font-semibold">
                                ₹{Number(r.fare_estimate).toFixed(0)}
                              </span>
                            )}
                          </div>
                          <div className="mt-2 space-y-1 text-sm">
                            <p>
                              <span className="text-green-600">●</span> {r.pickup_address}
                            </p>
                            <p>
                              <span className="text-red-600">●</span> {r.drop_address}
                            </p>
                          </div>
                        </div>
                        <Button asChild size="sm">
                          <Link to="/rider/active" search={{ id: r.id }}>
                            Open
                          </Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            <section>
              <h2 className="mb-2 text-lg font-semibold">
                Available rides ({availableRides.length})
              </h2>
              {loading ? (
                <p className="text-muted-foreground">Loading...</p>
              ) : availableRides.length === 0 ? (
                <p className="rounded-2xl border bg-card p-12 text-center text-muted-foreground">
                  <MapPin className="mx-auto mb-2 h-8 w-8" />
                  No ride requests in your area.
                </p>
              ) : (
                <div className="space-y-3">
                  {availableRides.map((r) => {
                    const Icon = VEHICLE_ICON[r.vehicle_type ?? "bike"] ?? Bike;
                    const pickup = { lat: r.pickup_lat, lng: r.pickup_lng };
                    const tooFar = loc ? distanceKm(loc, pickup) > MAX_ACCEPT_KM : true;
                    return (
                      <div key={r.id} className="rounded-xl border bg-card p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">{r.status}</Badge>
                            {r.profiles?.full_name && (
                              <span className="text-xs font-semibold">{r.profiles.full_name}</span>
                            )}
                              <Icon className="h-4 w-4" />
                              <span className="text-xs uppercase">{r.vehicle_type}</span>
                              {r.fare_estimate && (
                                <span className="text-sm font-semibold">
                                  ₹{Number(r.fare_estimate).toFixed(0)}
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {distLabel(pickup)}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1 text-sm">
                              <p>
                                <span className="text-green-600">●</span> {r.pickup_address}
                              </p>
                              <p>
                                <span className="text-red-600">●</span> {r.drop_address}
                              </p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            disabled={tooFar}
                            onClick={() => acceptRide(r.id, pickup)}
                          >
                            {tooFar ? "Too far" : "Accept"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
                </section>
                </TabsContent>

                <TabsContent value="packages" className="mt-4 space-y-6">
            {myPkgs.length > 0 && (
              <section>
                <h2 className="mb-2 text-lg font-semibold">Your active package</h2>
                {myPkgs.map((r) => (
                  <div key={r.id} className="rounded-xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge>{r.status}</Badge>
                          {r.profiles?.full_name && (
                            <span className="text-xs font-semibold">{r.profiles.full_name}</span>
                          )}
                          <PackageIcon className="h-4 w-4" />
                          <span className="text-xs uppercase">{r.package_size}</span>
                          {r.fare_estimate && (
                            <span className="text-sm font-semibold">
                              ₹{Number(r.fare_estimate).toFixed(0)}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 space-y-1 text-sm">
                          <p>
                            <span className="text-green-600">●</span> {r.pickup_address}
                          </p>
                          <p>
                            <span className="text-red-600">●</span> {r.drop_address}{" "}
                            {r.receiver_name && (
                              <span className="text-muted-foreground">({r.receiver_name})</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <Button asChild size="sm">
                        <Link to="/rider/active" search={{ id: r.id, kind: "package" }}>
                          Open
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            <section>
              <h2 className="mb-2 text-lg font-semibold">
                Available packages ({availablePkgs.length})
              </h2>
              {availablePkgs.length === 0 ? (
                <p className="rounded-2xl border bg-card p-12 text-center text-muted-foreground">
                  <PackageIcon className="mx-auto mb-2 h-8 w-8" />
                  No package requests in your area.
                </p>
              ) : (
                <div className="space-y-3">
                  {availablePkgs.map((r) => {
                    const pickup = { lat: r.pickup_lat, lng: r.pickup_lng };
                    const tooFar = loc ? distanceKm(loc, pickup) > MAX_ACCEPT_KM : true;
                    return (
                      <div key={r.id} className="rounded-xl border bg-card p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">{r.status}</Badge>
                            {r.profiles?.full_name && (
                              <span className="text-xs font-semibold">{r.profiles.full_name}</span>
                            )}
                              <PackageIcon className="h-4 w-4" />
                              <span className="text-xs uppercase">{r.package_size}</span>
                              {r.fare_estimate && (
                                <span className="text-sm font-semibold">
                                  ₹{Number(r.fare_estimate).toFixed(0)}
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {distLabel(pickup)}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1 text-sm">
                              <p>
                                <span className="text-green-600">●</span> {r.pickup_address}
                              </p>
                              <p>
                                <span className="text-red-600">●</span> {r.drop_address}
                              </p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            disabled={tooFar}
                            onClick={() => acceptPkg(r.id, pickup)}
                          >
                            {tooFar ? "Too far" : "Accept"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
                </section>
                </TabsContent>
              </Tabs>
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            {loadingHistory ? (
              <p className="text-muted-foreground">Loading history...</p>
            ) : (
              <Tabs defaultValue="rides" className="mt-4">
                <TabsList>
                  <TabsTrigger value="rides">Rides ({historyRides.length})</TabsTrigger>
                  <TabsTrigger value="packages">Packages ({historyPkgs.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="rides" className="mt-4">
                  {renderHistoryRides(historyRides)}
                </TabsContent>
                <TabsContent value="packages" className="mt-4">
                  {renderHistoryPackages(historyPkgs)}
                </TabsContent>
              </Tabs>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </RoleGate>
  );
}
