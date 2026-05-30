import type { LatLng } from "@/lib/geo";

export function openExternalNavigation(point: LatLng, label?: string) {
  const query = label ? encodeURIComponent(label) : `${point.lat},${point.lng}`;
  const google = `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}&destination_place_id=${query}`;
  window.open(google, "_blank", "noopener,noreferrer");
}
