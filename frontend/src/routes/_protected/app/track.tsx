import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { RouteMap, distanceKm, type LatLng } from "@/components/route-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const KIND_TO_TABLE = {
  ride: "rides",
  package: "package_deliveries",
  food: "food_orders",
  grocery: "grocery_orders",
} as const;

type Kind = keyof typeof KIND_TO_TABLE;

const searchSchema = z.object({
  id: z.string(),
  kind: z.enum(["ride", "package", "food", "grocery"]),
});

export const Route = createFileRoute("/_protected/app/track")({
  validateSearch: searchSchema,
  component: TrackOrder,
});

type TrackRow = {
  id: string;
  status: string;
  rider_id: string | null;
  rider_lat: number | null;
  rider_lng: number | null;
  rider_location_updated_at: string | null;
  pickup_lat?: number;
  pickup_lng?: number;
  pickup_address?: string;
  drop_lat?: number;
  drop_lng?: number;
  drop_address?: string;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  delivery_address?: string;
  fare_estimate?: number | null;
  total?: number | null;
};

const SPEED_KMH: Record<string, number> = {
  ride: 30, package: 25, food: 22, grocery: 22,
};

function statusLabel(status: string, kind: Kind) {
  const map: Record<string, string> = {
    requested: "Looking for a rider",
    pending: "Waiting for confirmation",
    accepted: kind === "ride" ? "Rider accepted — heading to pickup" : "Accepted by store",
    preparing: "Preparing your order",
    ready: "Ready for pickup",
    started: "On the way to drop",
    picked_up: "Picked up — on the way",
    out_for_delivery: "Out for delivery",
    delivered: "Delivered ✓",
    completed: "Completed ✓",
    cancelled: "Cancelled",
  };
  return map[status] ?? status;
}

function TrackOrder() {
  const { user } = useAuth();
  const { id, kind } = Route.useSearch();
  const table = KIND_TO_TABLE[kind];
  const [mounted, setMounted] = useState(false);
  const [row, setRow] = useState<TrackRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = async () => {
      const { row } = await api.track.get(kind, id);
      if (alive) {
        setRow((row as TrackRow | null) ?? null);
        setLoading(false);
      }
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user, table, id]);

  if (loading) return <div className="container mx-auto px-4 py-8 text-muted-foreground">Loading...</div>;
  if (!row) return <div className="container mx-auto px-4 py-8">Not found.</div>;

  // Coordinates depend on kind: rides/packages have pickup+drop; food/grocery have store location is unknown here, use delivery + rider
  let pickup: LatLng | null = null;
  let drop: LatLng | null = null;
  if (kind === "ride" || kind === "package") {
    pickup = { lat: row.pickup_lat!, lng: row.pickup_lng! };
    drop = { lat: row.drop_lat!, lng: row.drop_lng! };
  } else {
    // For food/grocery, treat rider's current as pickup-substitute and delivery address as drop
    if (row.delivery_lat && row.delivery_lng) {
      drop = { lat: row.delivery_lat, lng: row.delivery_lng };
      pickup = row.rider_lat && row.rider_lng
        ? { lat: row.rider_lat, lng: row.rider_lng }
        : drop;
    }
  }

  const rider = row.rider_lat && row.rider_lng ? { lat: row.rider_lat, lng: row.rider_lng } : null;
  const target = drop;
  const remainingKm = rider && target ? distanceKm(rider, target) : pickup && target ? distanceKm(pickup, target) : 0;
  const etaMin = remainingKm > 0 ? Math.max(1, Math.round((remainingKm / SPEED_KMH[kind]) * 60)) : 0;
  const lastUpdate = row.rider_location_updated_at ? new Date(row.rider_location_updated_at) : null;

  const fare = row.fare_estimate ?? row.total ?? 0;

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Track {kind}</h1>
        <Button asChild variant="outline" size="sm"><Link to="/app/orders">Back to orders</Link></Button>
      </div>

      <div className="mt-4 rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Badge>{row.status}</Badge>
            <p className="mt-1 text-lg font-semibold">{statusLabel(row.status, kind)}</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">ETA</div>
            <div className="text-2xl font-bold">{rider ? `${etaMin} min` : "—"}</div>
            <div className="text-xs text-muted-foreground">{remainingKm.toFixed(2)} km away</div>
          </div>
        </div>
        {!row.rider_id && (
          <p className="mt-3 text-sm text-amber-600">Waiting for a rider to accept…</p>
        )}
        {row.rider_id && !rider && (
          <p className="mt-3 text-sm text-muted-foreground">Rider connected. Awaiting live location…</p>
        )}
        {lastUpdate && (
          <p className="mt-2 text-xs text-muted-foreground">Last location update: {lastUpdate.toLocaleTimeString()}</p>
        )}
      </div>

      {pickup && drop && mounted && (
        <div className="mt-4">
          <RouteMap pickup={pickup} drop={drop} rider={rider} height={420} />
        </div>
      )}

      <div className="mt-4 rounded-2xl border bg-card p-4 text-sm">
        {row.pickup_address && <p><span className="text-green-600">●</span> Pickup: {row.pickup_address}</p>}
        {row.drop_address && <p><span className="text-red-600">●</span> Drop: {row.drop_address}</p>}
        {row.delivery_address && <p><span className="text-red-600">●</span> Delivery: {row.delivery_address}</p>}
        {fare > 0 && <p className="mt-2 font-semibold">Total: ₹{Number(fare).toFixed(0)}</p>}
      </div>
    </div>
  );
}
