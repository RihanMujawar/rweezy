import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { RouteMap, type LatLng } from "@/components/lazy-route-map";
import { distanceKm } from "@/lib/geo";
import { PageLoadingSkeleton } from "@/components/loading-skeleton";
import { OrderRatingPrompt } from "@/components/order-rating-prompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/chat-panel";
import { api } from "@/lib/api";
import { useOrderRealtime } from "@/hooks/use-order-realtime";

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
  partner?: { full_name?: string | null; phone?: string | null } | null;
  estimated_delivery_at?: string | null;
  estimated_arrival_at?: string | null;
  delivery_pin?: string | null;
};

const SPEED_KMH: Record<string, number> = {
  ride: 30,
  package: 25,
  food: 22,
  grocery: 22,
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = async () => {
      try {
        const { row } = await api.track.get(kind, id);
        if (alive) {
          setRow((row as TrackRow | null) ?? null);
          setError(null);
        }
      } catch (error) {
        if (alive) {
          setError(error instanceof Error ? error.message : "Failed to refresh tracking");
        }
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [user, kind, id]);

  useOrderRealtime({
    table,
    id,
    onChange: () => {
      api.track
        .get(kind, id)
        .then(({ row }) => setRow((row as TrackRow | null) ?? null))
        .catch(() => undefined);
    },
  });

  if (loading) return <PageLoadingSkeleton />;
  if (error) return <div className="container mx-auto px-4 py-8 text-red-600">{error}</div>;
  if (!row) return <div className="container mx-auto px-4 py-8">Not found.</div>;

  // Coordinates depend on kind: rides/packages have pickup+drop; food/grocery have store location is unknown here, use delivery + rider
  let pickup: LatLng | null = null;
  let drop: LatLng | null = null;
  if (kind === "ride" || kind === "package") {
    pickup = { lat: row.pickup_lat!, lng: row.pickup_lng! };
    drop = { lat: row.drop_lat!, lng: row.drop_lng! };
  } else {
    if (row.delivery_lat && row.delivery_lng) {
      drop = { lat: row.delivery_lat, lng: row.delivery_lng };
      pickup =
        row.pickup_lat && row.pickup_lng ? { lat: row.pickup_lat, lng: row.pickup_lng } : drop;
    }
  }

  const rider = row.rider_lat && row.rider_lng ? { lat: row.rider_lat, lng: row.rider_lng } : null;
  const target = drop;
  const remainingKm =
    rider && target ? distanceKm(rider, target) : pickup && target ? distanceKm(pickup, target) : 0;
  const etaMin =
    remainingKm > 0 ? Math.max(1, Math.round((remainingKm / SPEED_KMH[kind]) * 60)) : 0;
  const lastUpdate = row.rider_location_updated_at ? new Date(row.rider_location_updated_at) : null;

  const fare = row.fare_estimate ?? row.total ?? 0;

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Track {kind}</h1>
        <Button asChild variant="outline" size="sm">
          <Link to="/app/orders">Back to orders</Link>
        </Button>
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
          <p className="mt-3 text-sm text-muted-foreground">
            Rider connected. Awaiting live location…
          </p>
        )}
        {lastUpdate && (
          <p className="mt-2 text-xs text-muted-foreground">
            Last location update: {lastUpdate.toLocaleTimeString()}
          </p>
        )}
        {(row.estimated_delivery_at || row.estimated_arrival_at) && (
          <p className="mt-2 text-sm text-muted-foreground">
            Scheduled ETA:{" "}
            {new Date(row.estimated_delivery_at ?? row.estimated_arrival_at!).toLocaleString()}
          </p>
        )}
        {row.delivery_pin && row.status !== "delivered" && row.status !== "completed" && (
          <p className="mt-2 rounded-lg bg-secondary px-3 py-2 font-mono text-sm font-semibold">
            Share this PIN with your delivery partner: {row.delivery_pin}
          </p>
        )}
        {row.partner && (
          <div className="mt-3 rounded-lg bg-muted p-3 text-sm">
            <div className="font-medium">
              {kind === "ride" || kind === "package" ? "Rider" : "Delivery partner"}:{" "}
              {row.partner.full_name || "Assigned partner"}
            </div>
            {row.partner.phone && (
              <a className="text-primary underline" href={`tel:${row.partner.phone}`}>
                Call {row.partner.phone}
              </a>
            )}
            <div className="text-xs text-muted-foreground">
              Vehicle/contact details are shown when available on the partner profile.
            </div>
          </div>
        )}
      </div>

      {pickup && drop && mounted && (
        <div className="mt-4">
          <RouteMap pickup={pickup} drop={drop} rider={rider} height={420} />
        </div>
      )}

      <div className="mt-4 rounded-2xl border bg-card p-4 text-sm">
        {row.pickup_address && (
          <p>
            <span className="text-green-600">●</span> Pickup: {row.pickup_address}
          </p>
        )}
        {row.drop_address && (
          <p>
            <span className="text-red-600">●</span> Drop: {row.drop_address}
          </p>
        )}
        {row.delivery_address && (
          <p>
            <span className="text-red-600">●</span> Delivery: {row.delivery_address}
          </p>
        )}
        {fare > 0 && <p className="mt-2 font-semibold">Total: ₹{Number(fare).toFixed(0)}</p>}
      </div>

      <div className="mt-4">
        <ChatPanel
          kind={kind}
          serviceId={row.id}
          title={
            kind === "food" || kind === "grocery" ? "Chat with delivery partner" : "Chat with rider"
          }
          disabled={!row.rider_id}
        />
      </div>

      {(row.status === "delivered" || row.status === "completed") && (
        <OrderRatingPrompt serviceKind={kind} serviceId={row.id} />
      )}
    </div>
  );
}
