import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { registerWebPushForUser } from "@/lib/fcm";

export type AppRole =
  | "customer"
  | "admin"
  | "hotel_manager"
  | "grocery_manager"
  | "delivery_boy"
  | "rider"
  | "all_in_one_partner";

type AuthUser = {
  id: string;
  email?: string | null;
};

interface AuthContextValue {
  user: AuthUser | null;
  session: null;
  roles: AppRole[];
  loading: boolean;
  setAuthenticatedUser: (auth: { user: AuthUser | null; roles?: string[] }) => void;
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

  const setAuthenticatedUser = (auth: { user: AuthUser | null; roles?: string[] }) => {
    setUser(auth.user ?? null);
    setRoles((auth.roles as AppRole[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    refreshAuth();
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    registerWebPushForUser().catch(() => {
      // Permission denied / unsupported browsers / transient issues should not block auth flow.
    });
  }, [user?.id]);

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
      value={{
        user,
        session: null,
        roles,
        loading,
        setAuthenticatedUser,
        signOut,
        refreshRoles,
        refreshAuth,
      }}
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
