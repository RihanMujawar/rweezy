import type { LatLng } from "@/lib/geo";

export type GeocodeSuggestion = {
  id: string;
  label: string;
  point: LatLng;
};

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

export async function searchPlaces(
  query: string,
  near?: LatLng,
  signal?: AbortSignal,
): Promise<GeocodeSuggestion[]> {
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;

  if (mapboxToken) {
    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
    );
    url.searchParams.set("access_token", mapboxToken);
    url.searchParams.set("autocomplete", "true");
    url.searchParams.set("limit", "5");
    url.searchParams.set("language", "en");

    if (near) {
      url.searchParams.set("proximity", `${near.lng},${near.lat}`);
    }

    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error("Location search failed");
    }

    const data = await response.json();
    return (data.features ?? [])
      .filter((feature: any) => Array.isArray(feature.center))
      .map((feature: any) => ({
        id: feature.id,
        label: feature.place_name ?? feature.text ?? "Selected location",
        point: { lat: feature.center[1], lng: feature.center[0] },
      }));
  }

  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "en");

  if (near) {
    const radiusMeters = 50000;
    url.searchParams.set("lat", near.lat.toString());
    url.searchParams.set("lon", near.lng.toString());
    url.searchParams.set("zoom", "12");
    url.searchParams.set("radius", radiusMeters.toString());
  }

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error("Location search failed");
  }

  const data = await response.json();
  return (Array.isArray(data) ? data : []).map((item: any) => ({
    id: item.place_id?.toString() ?? `${item.lat}-${item.lon}`,
    label: item.display_name ?? "Selected location",
    point: {
      lat: Number(item.lat),
      lng: Number(item.lon),
    },
  }));
}

export async function reverseGeocode(point: LatLng, signal?: AbortSignal): Promise<string | null> {
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;

  if (mapboxToken) {
    try {
      const url = new URL(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${point.lng},${point.lat}.json`,
      );
      url.searchParams.set("access_token", mapboxToken);
      url.searchParams.set("limit", "1");
      url.searchParams.set("language", "en");
      const response = await fetch(url, { signal });
      if (!response.ok) return null;
      const data = await response.json();
      return data.features?.[0]?.place_name ?? null;
    } catch {
      return null;
    }
  }

  const url = new URL(`${NOMINATIM_BASE}/reverse`);
  url.searchParams.set("lat", point.lat.toString());
  url.searchParams.set("lon", point.lng.toString());
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("accept-language", "en");

  const response = await fetch(url, { signal });
  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return data?.display_name ?? null;
}
