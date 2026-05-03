import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { RoleGate } from "@/components/coming-soon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { distanceKm, type LatLng } from "@/components/route-map";
import { toast } from "sonner";
import { Bike, Car, Zap, MapPin, Package as PackageIcon } from "lucide-react";
import { api } from "@/lib/api";

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
  fare_estimate: number | null;
  status: string;
  created_at: string;
  rider_id: string | null;
  vehicle_type?: string | null;
};

type Pkg = {
  id: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  drop_address: string;
  fare_estimate: number | null;
  status: string;
  created_at: string;
  rider_id: string | null;
  package_size: string;
  receiver_name: string | null;
};

const VEHICLE_ICON: Record<string, typeof Bike> = { bike: Bike, auto: Zap, car: Car };

function RiderList() {
  const { user, roles } = useAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [pkgs, setPkgs] = useState<Pkg[]>([]);
  const [loc, setLoc] = useState<LatLng | null>(null);
  const [loading, setLoading] = useState(true);

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
    if (!user) return;
    const { rides: r, packages: p } = await api.rider.getJobs();
    setRides((r as Ride[]) ?? []);
    setPkgs((p as Pkg[]) ?? []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  const acceptRide = async (id: string, pickup: LatLng) => {
    if (!user) return;
    if (!loc) return toast.error("Enable location first");
    const d = distanceKm(loc, pickup);
    if (d > MAX_ACCEPT_KM) return toast.error(`You're ${d.toFixed(1)} km away. Must be within ${MAX_ACCEPT_KM} km.`);
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
    if (d > MAX_ACCEPT_KM) return toast.error(`You're ${d.toFixed(1)} km away. Must be within ${MAX_ACCEPT_KM} km.`);
    try {
      await api.rider.acceptPackage(id);
      toast.success("Package accepted!");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to accept package");
    }
  };

  const availableRides = rides.filter((r) => !r.rider_id);
  const myRides = rides.filter((r) => r.rider_id === user?.id);
  const availablePkgs = pkgs.filter((r) => !r.rider_id);
  const myPkgs = pkgs.filter((r) => r.rider_id === user?.id);

  const distLabel = (p: LatLng) => (loc ? `${distanceKm(loc, p).toFixed(1)} km away` : "—");

  return (
    <RoleGate allowed={["rider", "admin"]} hasAny={roles.includes("rider") || roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-2">
          <Bike className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Rider dashboard</h1>
        </div>
        {!loc && <p className="mt-2 text-xs text-amber-600">Enable browser location to see distances and accept rides.</p>}

        <Tabs defaultValue="rides" className="mt-6">
          <TabsList>
            <TabsTrigger value="rides">Rides ({availableRides.length + myRides.length})</TabsTrigger>
            <TabsTrigger value="packages">Packages ({availablePkgs.length + myPkgs.length})</TabsTrigger>
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
                            <Icon className="h-4 w-4" />
                            <span className="text-xs uppercase">{r.vehicle_type}</span>
                            {r.fare_estimate && <span className="text-sm font-semibold">₹{Number(r.fare_estimate).toFixed(0)}</span>}
                          </div>
                          <div className="mt-2 space-y-1 text-sm">
                            <p><span className="text-green-600">●</span> {r.pickup_address}</p>
                            <p><span className="text-red-600">●</span> {r.drop_address}</p>
                          </div>
                        </div>
                        <Button asChild size="sm"><Link to="/rider/active" search={{ id: r.id }}>Open</Link></Button>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            <section>
              <h2 className="mb-2 text-lg font-semibold">Available rides ({availableRides.length})</h2>
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
                              <Icon className="h-4 w-4" />
                              <span className="text-xs uppercase">{r.vehicle_type}</span>
                              {r.fare_estimate && <span className="text-sm font-semibold">₹{Number(r.fare_estimate).toFixed(0)}</span>}
                              <span className="text-xs text-muted-foreground">{distLabel(pickup)}</span>
                            </div>
                            <div className="mt-2 space-y-1 text-sm">
                              <p><span className="text-green-600">●</span> {r.pickup_address}</p>
                              <p><span className="text-red-600">●</span> {r.drop_address}</p>
                            </div>
                          </div>
                          <Button size="sm" disabled={tooFar} onClick={() => acceptRide(r.id, pickup)}>
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
                          <PackageIcon className="h-4 w-4" />
                          <span className="text-xs uppercase">{r.package_size}</span>
                          {r.fare_estimate && <span className="text-sm font-semibold">₹{Number(r.fare_estimate).toFixed(0)}</span>}
                        </div>
                        <div className="mt-2 space-y-1 text-sm">
                          <p><span className="text-green-600">●</span> {r.pickup_address}</p>
                          <p><span className="text-red-600">●</span> {r.drop_address} {r.receiver_name && <span className="text-muted-foreground">({r.receiver_name})</span>}</p>
                        </div>
                      </div>
                      <Button asChild size="sm"><Link to="/rider/active" search={{ id: r.id, kind: "package" }}>Open</Link></Button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            <section>
              <h2 className="mb-2 text-lg font-semibold">Available packages ({availablePkgs.length})</h2>
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
                              <PackageIcon className="h-4 w-4" />
                              <span className="text-xs uppercase">{r.package_size}</span>
                              {r.fare_estimate && <span className="text-sm font-semibold">₹{Number(r.fare_estimate).toFixed(0)}</span>}
                              <span className="text-xs text-muted-foreground">{distLabel(pickup)}</span>
                            </div>
                            <div className="mt-2 space-y-1 text-sm">
                              <p><span className="text-green-600">●</span> {r.pickup_address}</p>
                              <p><span className="text-red-600">●</span> {r.drop_address}</p>
                            </div>
                          </div>
                          <Button size="sm" disabled={tooFar} onClick={() => acceptPkg(r.id, pickup)}>
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
    </RoleGate>
  );
}
