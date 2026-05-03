import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PickerMap, distanceKm, type LatLng } from "@/components/route-map";
import { toast } from "sonner";
import { Car, Bike, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/app/ride")({
  component: BookRide,
});

type Vehicle = "bike" | "auto" | "car";
const VEHICLES: { id: Vehicle; label: string; icon: typeof Car; rate: number; base: number; eta: string }[] = [
  { id: "bike", label: "Bike", icon: Bike, rate: 8, base: 25, eta: "2 min" },
  { id: "auto", label: "Auto", icon: Zap, rate: 12, base: 35, eta: "4 min" },
  { id: "car", label: "Car", icon: Car, rate: 18, base: 60, eta: "6 min" },
];

function BookRide() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [drop, setDrop] = useState<LatLng | null>(null);
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropAddress, setDropAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [vehicle, setVehicle] = useState<Vehicle>("bike");
  const [placing, setPlacing] = useState(false);

  useEffect(() => setMounted(true), []);

  const km = pickup && drop ? distanceKm(pickup, drop) : 0;
  const fareFor = (v: Vehicle) => {
    const cfg = VEHICLES.find((x) => x.id === v)!;
    return km > 0 ? Math.max(cfg.base, Math.round(km * cfg.rate)) : 0;
  };
  const fare = fareFor(vehicle);

  const book = async () => {
    if (!user) return;
    if (!pickup || !drop) return toast.error("Drop pickup and drop pins on the map");
    if (!pickupAddress.trim() || !dropAddress.trim()) return toast.error("Add pickup and drop addresses");
    setPlacing(true);
    try {
      await api.rides.create({
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_address: pickupAddress,
        drop_lat: drop.lat,
        drop_lng: drop.lng,
        drop_address: dropAddress,
        fare_estimate: fare,
        vehicle_type: vehicle,
        notes,
      });
    } catch (error) {
      setPlacing(false);
      return toast.error(error instanceof Error ? error.message : "Failed to request ride");
    }
    setPlacing(false);
    toast.success("Ride requested! Looking for nearby riders.");
    navigate({ to: "/app/orders" });
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center gap-2">
        <Bike className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Book a ride</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Tap the map for <span className="font-medium text-green-600">pickup</span>, then{" "}
        <span className="font-medium text-red-600">drop</span>.
      </p>

      <div className="mt-4">
        {mounted ? (
          <PickerMap pickup={pickup} drop={drop} onChange={({ pickup: p, drop: d }) => { setPickup(p); setDrop(d); }} height={380} />
        ) : (
          <div className="h-[380px] rounded-xl border bg-muted" />
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Pickup address</Label>
          <Input value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} placeholder="Where to pick up?" />
        </div>
        <div className="space-y-2">
          <Label>Drop address</Label>
          <Input value={dropAddress} onChange={(e) => setDropAddress(e.target.value)} placeholder="Where to go?" />
        </div>
      </div>

      <div className="mt-6">
        <Label className="mb-2 block">Choose vehicle</Label>
        <div className="grid grid-cols-3 gap-3">
          {VEHICLES.map((v) => {
            const Icon = v.icon;
            const selected = vehicle === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setVehicle(v.id)}
                className={cn(
                  "rounded-2xl border bg-card p-4 text-left transition-all",
                  selected ? "border-primary ring-2 ring-primary" : "hover:border-muted-foreground/40",
                )}
              >
                <Icon className="h-7 w-7" />
                <div className="mt-2 font-semibold">{v.label}</div>
                <div className="text-xs text-muted-foreground">ETA {v.eta}</div>
                <div className="mt-1 text-sm font-bold">₹{fareFor(v.id) || "--"}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Label>Notes (optional)</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the rider should know?" />
      </div>

      <div className="mt-6 rounded-2xl border bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Distance</div>
            <div className="text-xl font-semibold">{km.toFixed(2)} km</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Fare ({vehicle})</div>
            <div className="text-xl font-semibold">₹{fare}</div>
          </div>
        </div>
        <Button className="mt-4 w-full" onClick={book} disabled={placing || !pickup || !drop}>
          {placing ? "Requesting..." : `Request ${vehicle}`}
        </Button>
      </div>
    </div>
  );
}
