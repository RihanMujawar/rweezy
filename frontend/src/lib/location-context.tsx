import React, { createContext, useContext, useState, useEffect } from "react";
import { LatLng } from "./geo";

interface LocationContextType {
  location: LatLng | null;
  address: string | null;
  setLocation: (loc: LatLng | null) => void;
  setAddress: (addr: string | null) => void;
  detectLocation: () => Promise<void>;
  loading: boolean;
  error: string | null;
  needsManualEntry: boolean;
  setNeedsManualEntry: (val: boolean) => void;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<LatLng | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsManualEntry, setNeedsManualEntry] = useState(false);

  const detectLocation = async () => {
    if (typeof window !== "undefined" && !window.isSecureContext && window.location.hostname !== "localhost") {
      setError("Location requires a secure (HTTPS) connection to work on mobile devices.");
      setNeedsManualEntry(true);
      return;
    }

    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }

    setLoading(true);
    setError(null);

    return new Promise<void>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const newLoc = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setLocation(newLoc);

          // Try to reverse geocode
          try {
            const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
            if (MAPBOX_TOKEN) {
              const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${newLoc.lng},${newLoc.lat}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
              const res = await fetch(url);
              const data = await res.json();
              if (data.features?.[0]) {
                setAddress(data.features[0].place_name);
              }
            } else {
               // Fallback to Nominatim
               const url = `https://nominatim.openstreetmap.org/reverse?lat=${newLoc.lat}&lon=${newLoc.lng}&format=json`;
               const res = await fetch(url);
               const data = await res.json();
               if (data.display_name) {
                 setAddress(data.display_name);
               }
            }
          } catch (e) {
            console.error("Reverse geocoding failed", e);
          }

          setLoading(false);
          resolve();
        },
        (err) => {
          setError(err.message);
          setLoading(false);
          setNeedsManualEntry(true);
          reject(err);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  };

  return (
    <LocationContext.Provider
      value={{
        location,
        address,
        setLocation,
        setAddress,
        detectLocation,
        loading,
        error,
        needsManualEntry,
        setNeedsManualEntry,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error("useLocation must be used within a LocationProvider");
  }
  return context;
}
