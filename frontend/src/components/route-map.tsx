import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export type LatLng = { lat: number; lng: number };

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
const MAPBOX_STYLE = "mapbox://styles/mapbox/streets-v12";
const DEFAULT_CENTER: LatLng = { lat: 12.9716, lng: 77.5946 };

type MarkerKind = "pickup" | "drop" | "rider";

type MapMarker = {
  id: string;
  point: LatLng;
  kind: MarkerKind;
};

type MapLine = {
  id: string;
  points: LatLng[];
  color: string;
  dashed?: boolean;
};

function coords(point: LatLng): [number, number] {
  return [point.lng, point.lat];
}

function markerElement(kind: MarkerKind) {
  const el = document.createElement("div");
  el.className = "grid place-items-center rounded-full border-[3px] border-white shadow-md";

  if (kind === "pickup") {
    el.style.cssText = "width:18px;height:18px;background:#22c55e;box-shadow:0 0 0 2px #22c55e";
  } else if (kind === "drop") {
    el.style.cssText = "width:18px;height:18px;background:#ef4444;box-shadow:0 0 0 2px #ef4444";
  } else {
    el.style.cssText = "width:24px;height:24px;background:#2563eb;color:white;font-size:12px;font-weight:700;box-shadow:0 0 0 2px #2563eb";
    el.textContent = "D";
  }

  return el;
}

function MapboxShell({
  center,
  markers,
  lines = [],
  height,
  onClick,
}: {
  center: LatLng;
  markers: MapMarker[];
  lines?: MapLine[];
  height: number;
  onClick?: (point: LatLng) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRefs = useRef<mapboxgl.Marker[]>([]);
  const onClickRef = useRef(onClick);

  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      center: coords(center),
      zoom: 13,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("click", (event) => {
      onClickRef.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });

    mapRef.current = map;

    return () => {
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = markers.map((marker) =>
      new mapboxgl.Marker({ element: markerElement(marker.kind), anchor: "center" })
        .setLngLat(coords(marker.point))
        .addTo(map),
    );

    const renderLines = () => {
      for (const line of lines) {
        const sourceId = `line-source-${line.id}`;
        const layerId = `line-layer-${line.id}`;
        const data: GeoJSON.Feature<GeoJSON.LineString> = {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: line.points.map(coords),
          },
        };

        const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
        if (source) {
          source.setData(data);
        } else {
          map.addSource(sourceId, { type: "geojson", data });
          map.addLayer({
            id: layerId,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": line.color,
              "line-width": line.id === "rider" ? 5 : 4,
              "line-opacity": line.id === "rider" ? 0.9 : 0.65,
              ...(line.dashed ? { "line-dasharray": [1.5, 2] } : {}),
            },
          });
        }
      }

      for (const id of ["route", "rider"]) {
        if (!lines.some((line) => line.id === id) && map.getLayer(`line-layer-${id}`)) {
          map.removeLayer(`line-layer-${id}`);
          map.removeSource(`line-source-${id}`);
        }
      }
    };

    if (map.isStyleLoaded()) {
      renderLines();
    } else {
      map.once("load", renderLines);
    }

    const points = [...markers.map((marker) => marker.point), ...lines.flatMap((line) => line.points)];
    if (points.length === 1) {
      map.flyTo({ center: coords(points[0]), zoom: 14, essential: false });
    } else if (points.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      points.forEach((point) => bounds.extend(coords(point)));
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 500 });
    } else {
      map.flyTo({ center: coords(center), zoom: 13, essential: false });
    }
  }, [center.lat, center.lng, markers, lines]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="grid place-items-center rounded-xl border bg-muted p-6 text-center text-sm text-muted-foreground" style={{ height }}>
        Add VITE_MAPBOX_ACCESS_TOKEN to your environment to enable Mapbox maps.
      </div>
    );
  }

  return <div ref={containerRef} className="overflow-hidden rounded-xl border" style={{ height }} />;
}

async function fetchRoute(from: LatLng, to: LatLng): Promise<LatLng[] | null> {
  try {
    const data = await api.map.getRoute(from.lat, from.lng, to.lat, to.lng);
    return data.route ?? null;
  } catch {
    return null;
  }
}

function useBrowserLocation(onPick: (point: LatLng) => void) {
  const [locating, setLocating] = useState(false);

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onPick({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
    );
  };

  return { locate, locating };
}

export function DeliveryPinMap({
  value,
  onChange,
  height = 320,
}: {
  value: LatLng | null;
  onChange: (point: LatLng) => void;
  height?: number;
}) {
  const { locate, locating } = useBrowserLocation(onChange);
  const center = value ?? DEFAULT_CENTER;
  const markers = useMemo<MapMarker[]>(
    () => (value ? [{ id: "delivery", point: value, kind: "drop" }] : []),
    [value],
  );

  return (
    <div className="space-y-2">
      <MapboxShell center={center} markers={markers} height={height} onClick={onChange} />
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{value ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : "Click the map to pin delivery location."}</span>
        <Button type="button" variant="outline" size="sm" onClick={locate} disabled={locating}>
          {locating ? "Locating..." : "Use my location"}
        </Button>
      </div>
    </div>
  );
}

export function StaticPointMap({
  point,
  height = 240,
}: {
  point: LatLng;
  height?: number;
}) {
  const markers = useMemo<MapMarker[]>(
    () => [{ id: "delivery", point, kind: "drop" }],
    [point],
  );

  return <MapboxShell center={point} markers={markers} height={height} />;
}

export function PickerMap({
  pickup,
  drop,
  onChange,
  height = 400,
}: {
  pickup: LatLng | null;
  drop: LatLng | null;
  onChange: (next: { pickup: LatLng | null; drop: LatLng | null }) => void;
  height?: number;
}) {
  const center = pickup ?? drop ?? DEFAULT_CENTER;
  const markers = useMemo<MapMarker[]>(
    () => [
      ...(pickup ? [{ id: "pickup", point: pickup, kind: "pickup" as const }] : []),
      ...(drop ? [{ id: "drop", point: drop, kind: "drop" as const }] : []),
    ],
    [pickup, drop],
  );

  const handleClick = (point: LatLng) => {
    if (!pickup) {
      onChange({ pickup: point, drop });
      return;
    }
    if (!drop) {
      onChange({ pickup, drop: point });
      return;
    }
    onChange({ pickup: point, drop: null });
  };

  return <MapboxShell center={center} markers={markers} height={height} onClick={handleClick} />;
}

export function RouteMap({
  pickup,
  drop,
  rider,
  height = 400,
}: {
  pickup: LatLng;
  drop: LatLng;
  rider?: LatLng | null;
  height?: number;
}) {
  const [route, setRoute] = useState<LatLng[]>([pickup, drop]);
  const [riderRoute, setRiderRoute] = useState<LatLng[] | null>(null);

  useEffect(() => {
    let alive = true;
    setRoute([pickup, drop]);
    fetchRoute(pickup, drop).then((nextRoute) => {
      if (alive && nextRoute && nextRoute.length > 1) setRoute(nextRoute);
    });
    return () => {
      alive = false;
    };
  }, [pickup.lat, pickup.lng, drop.lat, drop.lng]);

  useEffect(() => {
    if (!rider) {
      setRiderRoute(null);
      return;
    }

    let alive = true;
    fetchRoute(rider, drop).then((nextRoute) => {
      if (alive && nextRoute && nextRoute.length > 1) setRiderRoute(nextRoute);
    });
    return () => {
      alive = false;
    };
  }, [rider?.lat, rider?.lng, drop.lat, drop.lng]);

  const markers = useMemo<MapMarker[]>(
    () => [
      { id: "pickup", point: pickup, kind: "pickup" },
      { id: "drop", point: drop, kind: "drop" },
      ...(rider ? [{ id: "rider", point: rider, kind: "rider" as const }] : []),
    ],
    [pickup, drop, rider],
  );

  const lines = useMemo<MapLine[]>(
    () => [
      { id: "route", points: route, color: "#64748b", dashed: true },
      ...(riderRoute ? [{ id: "rider", points: riderRoute, color: "#2563eb" }] : []),
    ],
    [route, riderRoute],
  );

  return <MapboxShell center={pickup} markers={markers} lines={lines} height={height} />;
}

export function distanceKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
