import React, { createContext, useContext, useState } from "react";
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

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useState<LatLng | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsManualEntry, setNeedsManualEntry] = useState(false);

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
