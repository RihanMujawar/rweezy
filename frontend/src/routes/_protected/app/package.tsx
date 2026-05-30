import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PickerMap, type LatLng } from "@/components/lazy-route-map";
import { distanceKm } from "@/lib/geo";
import { OrderReceipt, type ReceiptData } from "@/components/order-receipt";
import { SavedAddressPicker } from "@/components/saved-address-picker";
import { PriceBreakdown } from "@/components/price-breakdown";
import { toast } from "sonner";
import { Package as PackageIcon, Bike, Zap, Car } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/app/package")({
  component: SendPackage,
});

type Size = "small" | "medium" | "large";
const SIZES: {
  id: Size;
  label: string;
  icon: typeof Bike;
  rate: number;
  base: number;
  desc: string;
}[] = [
  { id: "small", label: "Small", icon: Bike, rate: 10, base: 30, desc: "Documents, food" },
  { id: "medium", label: "Medium", icon: Zap, rate: 14, base: 50, desc: "Up to 10 kg" },
  { id: "large", label: "Large", icon: Car, rate: 20, base: 80, desc: "Up to 25 kg" },
];

function SendPackage() {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [drop, setDrop] = useState<LatLng | null>(null);
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropAddress, setDropAddress] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [size, setSize] = useState<Size>("small");
  const [placing, setPlacing] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  useEffect(() => setMounted(true), []);

  if (receipt) {
    return <OrderReceipt receipt={receipt} />;
  }

  const km = pickup && drop ? distanceKm(pickup, drop) : 0;
  const fareFor = (s: Size) => {
    const cfg = SIZES.find((x) => x.id === s)!;
    return km > 0 ? Math.max(cfg.base, Math.round(km * cfg.rate)) : 0;
  };
  const fare = fareFor(size);

  const book = async () => {
    if (!user) return;
    if (!pickup || !drop) return toast.error("Drop pickup and drop pins on the map");
    if (!pickupAddress.trim() || !dropAddress.trim()) return toast.error("Fill addresses");
    if (!receiverName.trim() || !receiverPhone.trim())
      return toast.error("Fill receiver name & phone");
    setPlacing(true);
    const platformFee = Math.max(15, Math.round(fare * 0.12));
    try {
      const { packageDelivery } = await api.packages.create({
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        pickup_address: pickupAddress,
        drop_lat: drop.lat,
        drop_lng: drop.lng,
        drop_address: dropAddress,
        fare_estimate: fare,
        package_size: size,
        receiver_name: receiverName,
        receiver_phone: receiverPhone,
        notes,
      });
      const placed = packageDelivery as {
        id?: string;
        delivery_pin?: string;
        estimated_delivery_at?: string;
      };
      setReceipt({
        id: placed.id,
        title: "Package requested",
        total: fare + platformFee,
        address: `${pickupAddress} → ${dropAddress}`,
        deliveryPin: placed.delivery_pin,
        estimatedAt: placed.estimated_delivery_at,
        trackKind: "package",
        lines: [
          { label: `Delivery (${size})`, amount: fare },
          { label: "Platform fee (demo)", amount: platformFee },
        ],
        paymentNote: "Cash on delivery (demo)",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to request pickup");
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center gap-2">
        <PackageIcon className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Send a package</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Tap the map for <span className="font-medium text-green-600">pickup</span>, then{" "}
        <span className="font-medium text-red-600">drop</span>.
      </p>

      <div className="mt-4">
        {mounted ? (
          <PickerMap
            pickup={pickup}
            drop={drop}
            onChange={({ pickup: p, drop: d }) => {
              setPickup(p);
              setDrop(d);
            }}
            onAddressChange={(kind, address) => {
              if (kind === "pickup") setPickupAddress(address);
              else setDropAddress(address);
            }}
            height={360}
          />
        ) : (
          <div className="h-[360px] rounded-xl border bg-muted" />
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Pickup address</Label>
          <Input value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Drop address</Label>
          <Input value={dropAddress} onChange={(e) => setDropAddress(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Receiver name</Label>
          <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Receiver phone</Label>
          <Input value={receiverPhone} onChange={(e) => setReceiverPhone(e.target.value)} />
        </div>
      </div>

      <div className="mt-6">
        <Label className="mb-2 block">Package size</Label>
        <div className="grid grid-cols-3 gap-3">
          {SIZES.map((s) => {
            const Icon = s.icon;
            const sel = size === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSize(s.id)}
                className={cn(
                  "rounded-2xl border bg-card p-4 text-left transition-all",
                  sel ? "border-primary ring-2 ring-primary" : "hover:border-muted-foreground/40",
                )}
              >
                <Icon className="h-7 w-7" />
                <div className="mt-2 font-semibold">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.desc}</div>
                <div className="mt-1 text-sm font-bold">₹{fareFor(s.id) || "--"}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Label>Notes (optional)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Item details / instructions"
        />
      </div>

      <div className="mt-6 rounded-2xl border bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Distance</div>
            <div className="text-xl font-semibold">{km.toFixed(2)} km</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Fare</div>
            <div className="text-xl font-semibold">₹{fare}</div>
          </div>
        </div>
        <Button className="mt-4 w-full" onClick={book} disabled={placing || !pickup || !drop}>
          {placing ? "Requesting..." : "Request pickup"}
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Payment: cash/manual demo on delivery.
        </p>
      </div>
    </div>
  );
}
