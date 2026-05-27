import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { type AppRole } from "@/lib/auth-context";

export type AppMode = "customer" | "business";

type AppModeContextValue = {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
};

const AppModeContext = createContext<AppModeContextValue | undefined>(undefined);
const BUSINESS_ROLES: AppRole[] = [
  "admin",
  "hotel_manager",
  "grocery_manager",
  "delivery_boy",
  "rider",
];

function inferModeFromPath(pathname: string) {
  return pathname.startsWith("/hotel") ||
    pathname.startsWith("/grocery-admin") ||
    pathname.startsWith("/delivery") ||
    pathname.startsWith("/rider") ||
    pathname.startsWith("/admin")
    ? "business"
    : "customer";
}

export function AppModeProvider({
  children,
  roles,
}: {
  children: ReactNode;
  roles: AppRole[];
}) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const hasBusinessMode = useMemo(
    () => roles.some((role) => BUSINESS_ROLES.includes(role)),
    [roles],
  );

  const [mode, setModeState] = useState<AppMode>(() => {
    const fromPath = inferModeFromPath(pathname);
    if (fromPath === "business" && hasBusinessMode) return "business";
    return "customer";
  });

  useEffect(() => {
    const fromPath = inferModeFromPath(pathname);
    if (fromPath === "business" && hasBusinessMode) setModeState("business");
  }, [pathname, hasBusinessMode]);

  const setMode = (next: AppMode) => {
    if (next === "business" && !hasBusinessMode) return;
    setModeState(next);
  };

  const toggleMode = () => {
    setMode(mode === "customer" ? "business" : "customer");
  };

  return (
    <AppModeContext.Provider value={{ mode, setMode, toggleMode }}>
      {children}
    </AppModeContext.Provider>
  );
}

export function useAppMode() {
  const ctx = useContext(AppModeContext);
  if (!ctx) throw new Error("useAppMode must be used within AppModeProvider");
  return ctx;
}

