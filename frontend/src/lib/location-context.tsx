import React, { createContext, useContext, useEffect, useState } from "react";
import { LatLng } from "./geo";
import { reverseGeocode } from "./geocoding";

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
const LOCATION_STORAGE_KEY = "rweezy_selected_location";

type StoredLocation = {
  location: LatLng | null;
  address: string | null;
};

function getStoredLocation(): StoredLocation {
  if (typeof window === "undefined") return { location: null, address: null };
  try {
    const value = JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY) ?? "null");
    if (
      value &&
      value.location &&
      typeof value.location.lat === "number" &&
      typeof value.location.lng === "number"
    ) {
      return { location: value.location, address: typeof value.address === "string" ? value.address : null };
    }
  } catch {
    // Ignore an invalid legacy value and let the user select a new location.
  }
  return { location: null, address: null };
}

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<LatLng | null>(() => getStoredLocation().location);
  const [address, setAddress] = useState<string | null>(() => getStoredLocation().address);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsManualEntry, setNeedsManualEntry] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!location) {
      localStorage.removeItem(LOCATION_STORAGE_KEY);
      return;
    }
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ location, address }));
  }, [location, address]);

  const detectLocation = async () => {
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
            const address = await reverseGeocode(newLoc);
            if (address) {
              setAddress(address);
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
