import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { RoleGate } from "@/components/coming-soon";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const { roles } = useAuth();
  const [stats, setStats] = useState({ users: 0, restaurants: 0, foodOrders: 0, rides: 0, packages: 0, stores: 0 });

  useEffect(() => {
    (async () => {
      const stats = await api.admin.getStats();
      setStats(stats);
    })();
  }, []);

  const tiles = [
    { label: "Users", value: stats.users },
    { label: "Restaurants", value: stats.restaurants },
    { label: "Grocery stores", value: stats.stores },
    { label: "Food orders", value: stats.foodOrders },
    { label: "Rides", value: stats.rides },
    { label: "Packages", value: stats.packages },
  ];

  return (
    <RoleGate allowed={["admin"]} hasAny={roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold">Admin overview</h1>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl border bg-card p-6">
              <div className="text-sm text-muted-foreground">{t.label}</div>
              <div className="mt-1 text-3xl font-bold">{t.value}</div>
            </div>
          ))}
        </div>
      </div>
    </RoleGate>
  );
}
