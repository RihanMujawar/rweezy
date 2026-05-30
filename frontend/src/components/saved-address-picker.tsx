import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { LatLng } from "@/lib/geo";

type Address = {
  id: string;
  label: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
};

export function SavedAddressPicker({
  onSelect,
}: {
  onSelect: (payload: { address: string; location: LatLng | null }) => void;
}) {
  const [addresses, setAddresses] = useState<Address[]>([]);

  useEffect(() => {
    api.profile
      .getAddresses()
      .then((data) => setAddresses((data.addresses as Address[]) ?? []))
      .catch(() => setAddresses([]));
  }, []);

  if (addresses.length === 0) return null;

  return (
    <div className="space-y-2">
      <Label>Saved address</Label>
      <select
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        defaultValue=""
        onChange={(event) => {
          const selected = addresses.find((item) => item.id === event.target.value);
          if (!selected) return;
          onSelect({
            address: selected.address,
            location:
              selected.lat != null && selected.lng != null
                ? { lat: selected.lat, lng: selected.lng }
                : null,
          });
        }}
      >
        <option value="" disabled>
          Choose saved address
        </option>
        {addresses.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label} — {item.address}
          </option>
        ))}
      </select>
    </div>
  );
}
