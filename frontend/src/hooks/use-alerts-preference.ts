import { useCallback, useEffect, useState } from "react";

export const ALERTS_STORAGE_KEY = "rweezy:alerts-enabled";
const ALERTS_CHANGED_EVENT = "rweezy:alerts-changed";

function readAlertsEnabled() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(ALERTS_STORAGE_KEY) !== "false";
}

export function useAlertsPreference() {
  const [alertsEnabled, setAlertsEnabledState] = useState(readAlertsEnabled);

  useEffect(() => {
    const sync = () => setAlertsEnabledState(readAlertsEnabled());
    window.addEventListener(ALERTS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ALERTS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setAlertsEnabled = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setAlertsEnabledState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      window.localStorage.setItem(ALERTS_STORAGE_KEY, next ? "true" : "false");
      window.dispatchEvent(new Event(ALERTS_CHANGED_EVENT));
      return next;
    });
  }, []);

  return { alertsEnabled, setAlertsEnabled };
}
