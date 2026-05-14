import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { useAuth } from "@/lib/auth-context";
import { RoleGate } from "@/components/coming-soon";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RouteMap } from "@/components/route-map";
import { useRiderBroadcast } from "@/lib/use-rider-broadcast";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { ChatPanel } from "@/components/chat-panel";

const searchSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["ride", "package"]).optional(),
});

export const Route = createFileRoute("/_protected/rider/active")({
  validateSearch: searchSchema,
  component: ActiveRide,
});

type Job = {
  id: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  drop_address: string;
  drop_lat: number;
  drop_lng: number;
  fare_estimate: number | null;
  status: string;
  rider_id: string | null;
  customer_id: string;
};

const NEXT_STATUS: Record<string, { label: string; next: "accepted" | "started" | "completed" } | null> = {
  accepted: { label: "Start trip (picked up)", next: "started" },
  started: { label: "Mark as completed", next: "completed" },
  completed: null,
  cancelled: null,
};

function ActiveRide() {
  const { user, roles } = useAuth();
  const { id, kind } = Route.useSearch();
  const [mounted, setMounted] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [table, setTable] = useState<"rides" | "package_deliveries">("rides");
  const [loading, setLoading] = useState(true);

  // Continuously broadcast rider's live location while there is an active job
  const broadcastActive = !!job && job.status !== "completed" && job.status !== "cancelled";
  useRiderBroadcast(broadcastActive ? table : null, broadcastActive ? job!.id : null, broadcastActive);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = async () => {
      const { job: row, table: nextTable } = await api.rider.getActive({
        id,
        kind: kind as "ride" | "package" | undefined,
      });
      if (!alive) return;
      setJob((row as Job | null) ?? null);
      setTable(nextTable);
      setLoading(false);
    };
    load();
    const timer = window.setInterval(load, 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user, id, kind]);

  const advance = async () => {
    if (!job) return;
    const next = NEXT_STATUS[job.status];
    if (!next) return;
    try {
      await api.rider.advance(table, job.id, next.next);
      toast.success(`Status: ${next.next}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update trip");
    }
  };

  const cancel = async () => {
    if (!job) return;
    if (!confirm("Cancel this job?")) return;
    try {
      await api.rider.cancel(table, job.id);
      toast.message("Cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel trip");
    }
  };

  return (
    <RoleGate allowed={["rider", "admin"]} hasAny={roles.includes("rider") || roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold">Active {table === "package_deliveries" ? "package" : "trip"}</h1>

        {loading ? (
          <p className="mt-4 text-muted-foreground">Loading...</p>
        ) : !job ? (
          <div className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">
            <p>No active job.</p>
            <Button asChild className="mt-4"><Link to="/rider">Find jobs</Link></Button>
          </div>
        ) : (
          <>
            <div className="mt-4">
              {mounted && (
                <RouteMap
                  pickup={{ lat: job.pickup_lat, lng: job.pickup_lng }}
                  drop={{ lat: job.drop_lat, lng: job.drop_lng }}
                  height={420}
                />
              )}
            </div>

            <div className="mt-4 rounded-2xl border bg-card p-6">
              <div className="flex items-center justify-between">
                <Badge>{job.status}</Badge>
                {job.fare_estimate && <span className="font-semibold">₹{Number(job.fare_estimate).toFixed(0)}</span>}
              </div>
              <div className="mt-3 space-y-1 text-sm">
                <p><span className="text-green-600">●</span> Pickup: {job.pickup_address}</p>
                <p><span className="text-red-600">●</span> Drop: {job.drop_address}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {NEXT_STATUS[job.status] && (
                  <Button onClick={advance}>{NEXT_STATUS[job.status]!.label}</Button>
                )}
                {job.status !== "completed" && job.status !== "cancelled" && (
                  <Button variant="outline" onClick={cancel}>Cancel</Button>
                )}
              </div>
            </div>

            <div className="mt-4">
              <ChatPanel
                kind={table === "package_deliveries" ? "package" : "ride"}
                serviceId={job.id}
                title="Chat with customer"
              />
            </div>
          </>
        )}
      </div>
    </RoleGate>
  );
}
