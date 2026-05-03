import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

export type AppRole =
  | "customer"
  | "admin"
  | "hotel_manager"
  | "grocery_manager"
  | "delivery_boy"
  | "rider";

type AuthUser = {
  id: string;
  email?: string | null;
};

interface AuthContextValue {
  user: AuthUser | null;
  session: null;
  roles: AppRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshAuth = async () => {
    try {
      const data = await api.auth.getMe();
      setUser(data.user ?? null);
      setRoles((data.roles as AppRole[]) ?? []);
    } catch {
      setUser(null);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAuth();
  }, []);

  const signOut = async () => {
    await api.auth.logout();
    setUser(null);
    setRoles([]);
  };

  const refreshRoles = async () => {
    await refreshAuth();
  };

  return (
    <AuthContext.Provider
      value={{ user, session: null, roles, loading, signOut, refreshRoles, refreshAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function hasRole(roles: AppRole[], role: AppRole) {
  return roles.includes(role);
}
