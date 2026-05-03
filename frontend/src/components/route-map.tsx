import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { api } from "@/lib/api";

const pickupIcon = L.divIcon({
  className: "",
  html: '<div style="background:#22c55e;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 0 2px #22c55e"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const dropIcon = L.divIcon({
  className: "",
  html: '<div style="background:#ef4444;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 0 2px #ef4444"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const riderIcon = L.divIcon({
  className: "",
  html: '<div style="background:#2563eb;width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 0 0 2px #2563eb;display:flex;align-items:center;justify-content:center;color:white;font-size:12px;font-weight:bold">🛵</div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export type LatLng = { lat: number; lng: number };

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Fetch route polyline from public OSRM demo server. */
async function fetchRoute(from: LatLng, to: LatLng): Promise<LatLng[] | null> {
  try {
    const data = await api.map.getRoute(from.lat, from.lng, to.lat, to.lng);
    return data.route ?? null;
  } catch {
    return null;
  }
}

function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, points]);
  return null;
}

function ClickHandler({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/** Map for picking pickup + drop pins. Click to place pickup, then drop. Click again to reset. */
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
  const center: [number, number] = pickup
    ? [pickup.lat, pickup.lng]
    : drop
    ? [drop.lat, drop.lng]
    : [12.9716, 77.5946];

  const handleClick = (p: LatLng) => {
    if (!pickup) return onChange({ pickup: p, drop });
    if (!drop) return onChange({ pickup, drop: p });
    onChange({ pickup: p, drop: null });
  };

  return (
    <div className="overflow-hidden rounded-xl border" style={{ height }}>
      <MapContainer center={center} zoom={13} style={{ height: "100%", width: "100%" }}>
        <TileLayer url={TILE_URL} attribution={ATTRIB} />
        <ClickHandler onClick={handleClick} />
        {pickup && <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon} />}
        {drop && <Marker position={[drop.lat, drop.lng]} icon={dropIcon} />}
        {pickup && drop && <FitBounds points={[pickup, drop]} />}
      </MapContainer>
    </div>
  );
}

/** Read-only map drawing route from pickup to drop. Optionally shows live rider position. */
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
    fetchRoute(pickup, drop).then((r) => {
      if (alive && r && r.length > 1) setRoute(r);
    });
    return () => { alive = false; };
  }, [pickup.lat, pickup.lng, drop.lat, drop.lng]);

  useEffect(() => {
    if (!rider) { setRiderRoute(null); return; }
    let alive = true;
    fetchRoute(rider, drop).then((r) => {
      if (alive && r && r.length > 1) setRiderRoute(r);
    });
    return () => { alive = false; };
  }, [rider?.lat, rider?.lng, drop.lat, drop.lng]);

  const fitPoints = rider ? [pickup, drop, rider] : [pickup, drop];

  return (
    <div className="overflow-hidden rounded-xl border" style={{ height }}>
      <MapContainer center={[pickup.lat, pickup.lng]} zoom={13} style={{ height: "100%", width: "100%" }}>
        <TileLayer url={TILE_URL} attribution={ATTRIB} />
        <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon} />
        <Marker position={[drop.lat, drop.lng]} icon={dropIcon} />
        <Polyline positions={route.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: "#94a3b8", weight: 4, opacity: 0.6, dashArray: "6 8" }} />
        {rider && (
          <>
            <Marker position={[rider.lat, rider.lng]} icon={riderIcon} />
            {riderRoute && (
              <Polyline positions={riderRoute.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.9 }} />
            )}
          </>
        )}
        <FitBounds points={fitPoints} />
      </MapContainer>
    </div>
  );
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
