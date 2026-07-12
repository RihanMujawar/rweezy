import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { api } from "@/lib/api";
import type { LatLng } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, LocateFixed, Search } from "lucide-react";

export type { LatLng };

const DEFAULT_CENTER: LatLng = { lat: 12.9716, lng: 77.5946 };
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;

type MarkerKind = "pickup" | "drop" | "rider" | "current";

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

type PlaceSearchResult = {
  id: string;
  label: string;
  point: LatLng;
};

function markerIcon(kind: MarkerKind) {
  let color = "#2563eb";
  let content = "";
  let size = 22;
  let shadow = "0 0 0 5px rgba(37,99,235,.22),0 0 0 2px #2563eb";

  if (kind === "pickup") {
    color = "#22c55e";
    size = 18;
    shadow = "0 0 0 2px #22c55e";
  } else if (kind === "drop") {
    color = "#ef4444";
    size = 18;
    shadow = "0 0 0 2px #ef4444";
  } else if (kind === "rider") {
    color = "#2563eb";
    size = 24;
    content = "D";
    shadow = "0 0 0 2px #2563eb";
  }

  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:3px solid white;border-radius:50%;box-shadow:${shadow};display:grid;place-items:center;color:white;font-size:12px;font-weight:700;">${content}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function LeafletShell({
  center,
  markers,
  lines = [],
  height,
  onClick,
  onMarkerClick,
}: {
  center: LatLng;
  markers: MapMarker[];
  lines?: MapLine[];
  height: number;
  onClick?: (point: LatLng) => void;
  onMarkerClick?: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersGroupRef = useRef<L.LayerGroup | null>(null);
  const linesGroupRef = useRef<L.LayerGroup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const onClickRef = useRef(onClick);

  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: 13,
      zoomControl: false,
    });

    L.control.zoom({ position: "topright" }).addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    map.on("click", (e) => {
      onClickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    markersGroupRef.current = L.layerGroup().addTo(map);
    linesGroupRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;
    setMapReady(true);

    // Ensure map tiles are loaded correctly on mobile/dynamic containers
    setTimeout(() => {
      map.invalidateSize();
    }, 100);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Update Markers
    if (markersGroupRef.current) {
      markersGroupRef.current.clearLayers();
      markers.forEach((m) => {
        const marker = L.marker([m.point.lat, m.point.lng], {
          icon: markerIcon(m.kind),
        });
        marker.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          onMarkerClick?.(m.id);
        });
        marker.addTo(markersGroupRef.current!);
      });
    }

    // Update Lines
    if (linesGroupRef.current) {
      linesGroupRef.current.clearLayers();
      lines.forEach((l) => {
        const polyline = L.polyline(
          l.points.map((p) => [p.lat, p.lng]),
          {
            color: l.color,
            weight: l.id === "rider" ? 5 : 4,
            opacity: l.id === "rider" ? 0.9 : 0.65,
            dashArray: l.dashed ? "5, 10" : undefined,
          }
        );
        polyline.addTo(linesGroupRef.current!);
      });
    }

    // Fit Bounds
    const allPoints = [
      ...markers.map((m) => [m.point.lat, m.point.lng] as L.LatLngTuple),
      ...lines.flatMap((l) => l.points.map((p) => [p.lat, p.lng] as L.LatLngTuple)),
    ];

    if (allPoints.length === 1) {
      map.setView(allPoints[0], 15);
    } else if (allPoints.length > 1) {
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
    } else {
      map.setView([center.lat, center.lng], 13);
    }
  }, [center, markers, lines, mapReady]);

  return (
    <div className="relative overflow-hidden rounded-xl border" style={{ height }}>
      <div ref={containerRef} className="h-full w-full z-0" />
    </div>
  );
}

async function fetchRoute(from: LatLng, to: LatLng): Promise<LatLng[] | null> {
  try {
    const data = await api.map.getRoute(from.lat, from.lng, to.lat, to.lng);
    return data.route ?? null;
  } catch {
    return null;
  }
}

async function searchPlaces(query: string, near: LatLng): Promise<PlaceSearchResult[]> {
  // We'll stick to Mapbox for geocoding if token is available, or fallback to Nominatim
  if (MAPBOX_TOKEN) {
    const url = new URL(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
    );
    url.searchParams.set("access_token", MAPBOX_TOKEN);
    url.searchParams.set("autocomplete", "true");
    url.searchParams.set("limit", "5");
    url.searchParams.set("language", "en");
    url.searchParams.set("proximity", `${near.lng},${near.lat}`);

    const response = await fetch(url);
    if (!response.ok) throw new Error("Location search failed");

    const data = await response.json();
    return (data.features ?? [])
      .filter((feature: any) => Array.isArray(feature.center))
      .map((feature: any) => ({
        id: feature.id,
        label: feature.place_name ?? feature.text ?? "Selected location",
        point: { lat: feature.center[1], lng: feature.center[0] },
      }));
  }

  // Fallback to OSM Nominatim
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Location search failed");
  const data = await response.json();
  return data.map((item: any) => ({
    id: item.place_id.toString(),
    label: item.display_name,
    point: { lat: parseFloat(item.lat), lng: parseFloat(item.lon) },
  }));
}

async function reverseGeocode(point: LatLng): Promise<string | null> {
  if (MAPBOX_TOKEN) {
    try {
      const url = new URL(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${point.lng},${point.lat}.json`,
      );
      url.searchParams.set("access_token", MAPBOX_TOKEN);
      url.searchParams.set("limit", "1");
      url.searchParams.set("language", "en");
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      return data.features?.[0]?.place_name ?? null;
    } catch {
      return null;
    }
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", point.lat.toString());
    url.searchParams.set("lon", point.lng.toString());
    url.searchParams.set("format", "json");
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return data.display_name ?? null;
  } catch {
    return null;
  }
}

function LocationSearch({
  center,
  onSelect,
  placeholder,
}: {
  center: LatLng;
  onSelect: (point: LatLng, label?: string) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const runSearch = async () => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      setMessage("Type at least 3 characters to search.");
      return;
    }

    setSearching(true);
    setMessage(null);

    try {
      const nextResults = await searchPlaces(trimmed, center);
      setResults(nextResults);
      setMessage(nextResults.length === 0 ? "No matching locations found." : null);
    } catch {
      setResults([]);
      setMessage("Could not search locations. Check internet and try again.");
    } finally {
      setSearching(false);
    }
  };

  const selectResult = (result: PlaceSearchResult) => {
    setQuery(result.label);
    setResults([]);
    setMessage("Location selected. Adjust the pin on the map if needed.");
    onSelect(result.point, result.label);
  };

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
        <Button type="submit" variant="outline" size="icon" disabled={searching}>
          <Search className="h-4 w-4" />
          <span className="sr-only">Search location</span>
        </Button>
      </form>

      {results.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-card text-sm shadow-sm z-50 relative">
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              className="block w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted"
              onClick={() => selectResult(result)}
            >
              {result.label}
            </button>
          ))}
        </div>
      )}

      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}

function useBrowserLocation(onPick: (point: LatLng) => void) {
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isSecureLocationContext = () => {
    if (typeof window === "undefined") return false;
    return (
      window.isSecureContext ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    );
  };

  const finishWithError = (error: GeolocationPositionError) => {
    setLocating(false);

    if (error.code === error.PERMISSION_DENIED) {
      setMessage(
        isSecureLocationContext()
          ? "Location permission is blocked. Allow location for this site in your browser settings, then try again."
          : "Location needs HTTPS. Open the app with an https:// URL or localhost, then try again.",
      );
      return;
    }

    if (error.code === error.POSITION_UNAVAILABLE) {
      setMessage("Your phone could not find a GPS location. Turn on Location/GPS and try again.");
      return;
    }

    if (error.code === error.TIMEOUT) {
      setMessage(
        "Location timed out. Move near a window or turn on high accuracy/GPS, then try again.",
      );
      return;
    }

    setMessage("Could not read your current location. You can still tap the map to set the pin.");
  };

  const handleSuccess = (position: GeolocationPosition) => {
    setLocating(false);
    setMessage("Phone location pinned. Adjust it on the map if needed.");
    onPick({ lat: position.coords.latitude, lng: position.coords.longitude });
  };

  const locate = async () => {
    if (!isSecureLocationContext()) {
      setMessage(
        "Location needs HTTPS. Browser permission prompts do not appear on normal http:// phone or LAN links.",
      );
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMessage("This browser does not support current location. Tap the map to set the pin.");
      return;
    }

    setLocating(true);
    setMessage("Asking your browser for location permission...");

    navigator.geolocation.getCurrentPosition(handleSuccess, finishWithError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 12000,
    });
  };

  return { locate, locating, message };
}

export function DeliveryPinMap({
  value,
  onChange,
  onAddressChange,
  height = 320,
}: {
  value: LatLng | null;
  onChange: (point: LatLng) => void;
  onAddressChange?: (address: string) => void;
  height?: number;
}) {
  const [usingPhoneLocation, setUsingPhoneLocation] = useState(false);
  const { locate, locating, message } = useBrowserLocation((point) => {
    setUsingPhoneLocation(true);
    onChange(point);
    reverseGeocode(point).then((address) => {
      if (address) onAddressChange?.(address);
    });
  });
  const center = value ?? DEFAULT_CENTER;
  const markers = useMemo<MapMarker[]>(
    () =>
      value
        ? [{ id: "delivery", point: value, kind: usingPhoneLocation ? "current" : "drop" }]
        : [],
    [value, usingPhoneLocation],
  );

  const handleMapClick = (point: LatLng) => {
    setUsingPhoneLocation(false);
    onChange(point);
    reverseGeocode(point).then((address) => {
      if (address) onAddressChange?.(address);
    });
  };

  const handleSearchSelect = (point: LatLng, label?: string) => {
    setUsingPhoneLocation(false);
    onChange(point);
    if (label) onAddressChange?.(label);
  };

  return (
    <div className="space-y-2">
      <LocationSearch
        center={center}
        onSelect={handleSearchSelect}
        placeholder="Search delivery location"
      />
      <LeafletShell center={center} markers={markers} height={height} onClick={handleMapClick} />
      <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <div className="min-w-0 space-y-1">
          <p>
            {value
              ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`
              : "Click the map to pin delivery location."}
          </p>
          {message && <p className="text-muted-foreground">{message}</p>}
        </div>
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
  markers: externalMarkers,
  onMarkerClick,
}: {
  point: LatLng;
  height?: number;
  markers?: MapMarker[];
  onMarkerClick?: (id: string) => void;
}) {
  const markers = useMemo<MapMarker[]>(
    () => externalMarkers ?? [{ id: "delivery", point, kind: "drop" }],
    [point, externalMarkers],
  );

  return (
    <LeafletShell
      center={point}
      markers={markers}
      height={height}
      onMarkerClick={onMarkerClick}
    />
  );
}

export function PickerMap({
  pickup,
  drop,
  onChange,
  onAddressChange,
  height = 400,
}: {
  pickup: LatLng | null;
  drop: LatLng | null;
  onChange: (next: { pickup: LatLng | null; drop: LatLng | null }) => void;
  onAddressChange?: (kind: "pickup" | "drop", address: string) => void;
  height?: number;
}) {
  const [usingPhoneLocation, setUsingPhoneLocation] = useState(false);
  const { locate, locating, message } = useBrowserLocation((point) => {
    setUsingPhoneLocation(true);
    if (!pickup) {
      onChange({ pickup: point, drop });
      reverseGeocode(point).then((address) => {
        if (address) onAddressChange?.("pickup", address);
      });
      return;
    }
    if (!drop) {
      onChange({ pickup, drop: point });
      reverseGeocode(point).then((address) => {
        if (address) onAddressChange?.("drop", address);
      });
      return;
    }
    onChange({ pickup: point, drop });
    reverseGeocode(point).then((address) => {
      if (address) onAddressChange?.("pickup", address);
    });
  });
  const center = pickup ?? drop ?? DEFAULT_CENTER;
  const markers = useMemo<MapMarker[]>(
    () => [
      ...(pickup ? [{ id: "pickup", point: pickup, kind: "pickup" as const }] : []),
      ...(drop ? [{ id: "drop", point: drop, kind: "drop" as const }] : []),
    ],
    [pickup, drop],
  );

  const assignPoint = (point: LatLng, label?: string) => {
    setUsingPhoneLocation(false);
    if (!pickup) {
      onChange({ pickup: point, drop });
      if (label) onAddressChange?.("pickup", label);
      else reverseGeocode(point).then((address) => address && onAddressChange?.("pickup", address));
      return;
    }
    if (!drop) {
      onChange({ pickup, drop: point });
      if (label) onAddressChange?.("drop", label);
      else reverseGeocode(point).then((address) => address && onAddressChange?.("drop", address));
      return;
    }
    onChange({ pickup: point, drop: null });
    if (label) onAddressChange?.("pickup", label);
    else reverseGeocode(point).then((address) => address && onAddressChange?.("pickup", address));
  };

  return (
    <div className="space-y-2">
      <LocationSearch
        center={center}
        onSelect={assignPoint}
        placeholder={!pickup ? "Search pickup location" : "Search drop location"}
      />
      <LeafletShell center={center} markers={markers} height={height} onClick={assignPoint} />
      <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <div className="min-w-0 space-y-1">
          <p>
            {pickup && drop
              ? `Pickup and drop are selected. Tap the map to replace the pickup point.`
              : !pickup
                ? "Choose pickup first, then drop."
                : "Choose your drop point next."}
          </p>
          {message && <p>{message}</p>}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={locate} disabled={locating}>
          <LocateFixed className="mr-2 h-4 w-4" />
          {locating ? "Locating..." : "Use my location"}
        </Button>
      </div>
      {usingPhoneLocation && (
        <p className="text-xs text-muted-foreground">Current location picked from your device.</p>
      )}
    </div>
  );
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
  }, [pickup, drop]);

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
  }, [rider, drop]);

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

  return <LeafletShell center={pickup} markers={markers} lines={lines} height={height} />;
}
