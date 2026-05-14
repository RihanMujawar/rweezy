import { useEffect } from "react";
import { api } from "@/lib/api";

/** Continuously broadcast rider's geolocation to the given table/row. */
export function useRiderBroadcast(
  table: "rides" | "package_deliveries" | "food_orders" | "grocery_orders" | null,
  rowId: string | null,
  active: boolean,
) {
  useEffect(() => {
    if (!active || !table || !rowId) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let lastSent = 0;
    const watch = navigator.geolocation.watchPosition(
      async (p) => {
        const now = Date.now();
        if (now - lastSent < 4000) return; // throttle to ~every 4s
        lastSent = now;
        await api.liveLocation.update({
          table,
          row_id: rowId,
          rider_lat: p.coords.latitude,
          rider_lng: p.coords.longitude,
        });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [table, rowId, active]);
}
