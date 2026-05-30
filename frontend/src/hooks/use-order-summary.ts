import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type SummaryOrder = {
  id: string;
  status: string;
  created_at: string;
};

type SummaryKind = "food" | "grocery" | "ride" | "package";

export type ActiveOrderLink = {
  id: string;
  kind: SummaryKind;
  label: string;
  status: string;
  created_at: string;
};

const ACTIVE = (status: string) =>
  status !== "delivered" && status !== "completed" && status !== "cancelled";

function newest<T extends SummaryOrder>(orders: T[]) {
  return [...orders].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
}

export function useOrderSummary() {
  const { user } = useAuth();
  const [activeOrders, setActiveOrders] = useState<ActiveOrderLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = async () => {
      try {
        const { food, grocery, rides, packages } = await api.orders.getMine();
        if (!alive) return;
        const foodOrders = ((food as SummaryOrder[]) ?? []).filter((order) => ACTIVE(order.status));
        const groceryOrders = ((grocery as SummaryOrder[]) ?? []).filter((order) =>
          ACTIVE(order.status),
        );
        const rideOrders = ((rides as SummaryOrder[]) ?? []).filter((order) =>
          ACTIVE(order.status),
        );
        const packageOrders = ((packages as SummaryOrder[]) ?? []).filter((order) =>
          ACTIVE(order.status),
        );
        setActiveOrders([
          ...foodOrders.map((order) => ({
            id: order.id,
            kind: "food" as const,
            label: "Food order",
            status: order.status,
            created_at: order.created_at,
          })),
          ...groceryOrders.map((order) => ({
            id: order.id,
            kind: "grocery" as const,
            label: "Grocery order",
            status: order.status,
            created_at: order.created_at,
          })),
          ...rideOrders.map((order) => ({
            id: order.id,
            kind: "ride" as const,
            label: "Ride",
            status: order.status,
            created_at: order.created_at,
          })),
          ...packageOrders.map((order) => ({
            id: order.id,
            kind: "package" as const,
            label: "Package",
            status: order.status,
            created_at: order.created_at,
          })),
        ]);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user]);

  const latestActiveOrder = useMemo(() => newest(activeOrders), [activeOrders]);

  return { activeOrders, latestActiveOrder, loading };
}
