import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { RoleGate } from "@/components/coming-soon";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Bike, Building2, IndianRupee, PackageCheck, Percent, Store } from "lucide-react";

export const Route = createFileRoute("/_protected/admin/")({
  component: AdminDashboard,
});

type Stats = {
  users: number;
  restaurants: number;
  foodOrders: number;
  rides: number;
  packages: number;
  stores: number;
};

type PartnerIncome = {
  id: string;
  name: string;
  is_open: boolean;
  todayOrders: number;
  todayIncome: number;
  monthOrders: number;
  monthIncome: number;
  totalOrders: number;
};

type DeliveryBoy = {
  id: string;
  name: string;
  phone: string | null;
  foodDeliveries: number;
  groceryDeliveries: number;
  todayDeliveries: number;
  monthDeliveries: number;
  totalDeliveries: number;
  trackedKm: number;
  foodIncomeHandled: number;
  groceryIncomeHandled: number;
};

type Analytics = {
  restaurantIncome: PartnerIncome[];
  groceryStoreIncome: PartnerIncome[];
  deliveryBoys: DeliveryBoy[];
  totals: {
    restaurantTodayIncome: number;
    restaurantMonthIncome: number;
    groceryTodayIncome: number;
    groceryMonthIncome: number;
    deliveryBoys: number;
    deliveriesToday: number;
    deliveriesMonth: number;
    trackedKm: number;
  };
};

const emptyStats: Stats = {
  users: 0,
  restaurants: 0,
  foodOrders: 0,
  rides: 0,
  packages: 0,
  stores: 0,
};

const emptyAnalytics: Analytics = {
  restaurantIncome: [],
  groceryStoreIncome: [],
  deliveryBoys: [],
  totals: {
    restaurantTodayIncome: 0,
    restaurantMonthIncome: 0,
    groceryTodayIncome: 0,
    groceryMonthIncome: 0,
    deliveryBoys: 0,
    deliveriesToday: 0,
    deliveriesMonth: 0,
    trackedKm: 0,
  },
};

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatCurrency(value: number) {
  return currency.format(Number.isFinite(value) ? value : 0);
}

function commission(total: number, rate: number) {
  return (Number(total) || 0) * ((Number(rate) || 0) / 100);
}

function AdminDashboard() {
  const { roles } = useAuth();
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [analytics, setAnalytics] = useState<Analytics>(emptyAnalytics);
  const [loading, setLoading] = useState(true);
  const [restaurantCommissionRate, setRestaurantCommissionRate] = useState(10);
  const [groceryCommissionRate, setGroceryCommissionRate] = useState(8);
  const [deliveryCommissionRate, setDeliveryCommissionRate] = useState(12);

  useEffect(() => {
    (async () => {
      const [nextStats, nextAnalytics] = await Promise.all([
        api.admin.getStats(),
        api.admin.getAnalytics(),
      ]);
      setStats(nextStats);
      setAnalytics({
        restaurantIncome: (nextAnalytics.restaurantIncome as PartnerIncome[]) ?? [],
        groceryStoreIncome: (nextAnalytics.groceryStoreIncome as PartnerIncome[]) ?? [],
        deliveryBoys: (nextAnalytics.deliveryBoys as DeliveryBoy[]) ?? [],
        totals: nextAnalytics.totals ?? emptyAnalytics.totals,
      });
      setLoading(false);
    })();
  }, []);

  const monthlyPartnerCommission = useMemo(
    () =>
      commission(analytics.totals.restaurantMonthIncome, restaurantCommissionRate) +
      commission(analytics.totals.groceryMonthIncome, groceryCommissionRate),
    [analytics.totals.groceryMonthIncome, analytics.totals.restaurantMonthIncome, groceryCommissionRate, restaurantCommissionRate],
  );

  const monthlyDeliveryCommission = useMemo(
    () =>
      analytics.deliveryBoys.reduce(
        (sum, boy) =>
          sum +
          commission(boy.foodIncomeHandled + boy.groceryIncomeHandled, deliveryCommissionRate),
        0,
      ),
    [analytics.deliveryBoys, deliveryCommissionRate],
  );

  const tiles = [
    { label: "Users", value: stats.users },
    { label: "Restaurants", value: stats.restaurants },
    { label: "Grocery stores", value: stats.stores },
    { label: "Food orders", value: stats.foodOrders },
    { label: "Rides", value: stats.rides },
    { label: "Packages", value: stats.packages },
  ];

  const moneyTiles = [
    {
      label: "Restaurant income today",
      value: formatCurrency(analytics.totals.restaurantTodayIncome),
      icon: Building2,
    },
    {
      label: "Restaurant income month",
      value: formatCurrency(analytics.totals.restaurantMonthIncome),
      icon: IndianRupee,
    },
    {
      label: "Grocery income today",
      value: formatCurrency(analytics.totals.groceryTodayIncome),
      icon: Store,
    },
    {
      label: "Grocery income month",
      value: formatCurrency(analytics.totals.groceryMonthIncome),
      icon: IndianRupee,
    },
    {
      label: "Delivery boys",
      value: String(analytics.totals.deliveryBoys),
      icon: Bike,
    },
    {
      label: "Tracked distance",
      value: `${analytics.totals.trackedKm.toFixed(1)} km`,
      icon: PackageCheck,
    },
  ];

  return (
    <RoleGate allowed={["admin"]} hasAny={roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Admin overview</h1>
            <p className="text-sm text-muted-foreground">
              Track partner income, delivery performance, and commission estimates.
            </p>
          </div>
          {loading && <Badge variant="secondary">Loading</Badge>}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-xl border bg-card p-5">
              <div className="text-sm text-muted-foreground">{tile.label}</div>
              <div className="mt-1 text-3xl font-bold">{tile.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {moneyTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <div key={tile.label} className="rounded-xl border bg-card p-5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon className="h-4 w-4" />
                  {tile.label}
                </div>
                <div className="mt-2 text-2xl font-bold">{tile.value}</div>
              </div>
            );
          })}
        </div>

        <section className="mt-8 rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Commission manager</h2>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <Label>Restaurant commission %</Label>
              <Input
                min={0}
                step={0.5}
                type="number"
                value={restaurantCommissionRate}
                onChange={(event) => setRestaurantCommissionRate(Number(event.target.value))}
              />
            </div>
            <div>
              <Label>Grocery commission %</Label>
              <Input
                min={0}
                step={0.5}
                type="number"
                value={groceryCommissionRate}
                onChange={(event) => setGroceryCommissionRate(Number(event.target.value))}
              />
            </div>
            <div>
              <Label>Delivery boy commission %</Label>
              <Input
                min={0}
                step={0.5}
                type="number"
                value={deliveryCommissionRate}
                onChange={(event) => setDeliveryCommissionRate(Number(event.target.value))}
              />
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-muted p-4">
              <div className="text-sm text-muted-foreground">Partner commission this month</div>
              <div className="mt-1 text-2xl font-semibold">{formatCurrency(monthlyPartnerCommission)}</div>
            </div>
            <div className="rounded-lg bg-muted p-4">
              <div className="text-sm text-muted-foreground">Delivery boy commission this month</div>
              <div className="mt-1 text-2xl font-semibold">{formatCurrency(monthlyDeliveryCommission)}</div>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          <PartnerIncomeTable
            title="Restaurant income"
            rows={analytics.restaurantIncome}
            commissionRate={restaurantCommissionRate}
          />
          <PartnerIncomeTable
            title="Grocery store income"
            rows={analytics.groceryStoreIncome}
            commissionRate={groceryCommissionRate}
          />
        </div>

        <section className="mt-8 rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Delivery boy tracking</h2>
              <p className="text-sm text-muted-foreground">
                Distance uses the saved live rider location and delivery destination when both are available.
              </p>
            </div>
            <Badge variant="outline">{analytics.totals.deliveriesMonth} this month</Badge>
          </div>
          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>Delivery boy</TableHead>
                <TableHead className="text-right">Food</TableHead>
                <TableHead className="text-right">Grocery</TableHead>
                <TableHead className="text-right">Today</TableHead>
                <TableHead className="text-right">Month</TableHead>
                <TableHead className="text-right">Km</TableHead>
                <TableHead className="text-right">Commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analytics.deliveryBoys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No delivery boys found.
                  </TableCell>
                </TableRow>
              ) : (
                analytics.deliveryBoys.map((boy) => (
                  <TableRow key={boy.id}>
                    <TableCell>
                      <div className="font-medium">{boy.name}</div>
                      <div className="text-xs text-muted-foreground">{boy.phone ?? boy.id}</div>
                    </TableCell>
                    <TableCell className="text-right">{boy.foodDeliveries}</TableCell>
                    <TableCell className="text-right">{boy.groceryDeliveries}</TableCell>
                    <TableCell className="text-right">{boy.todayDeliveries}</TableCell>
                    <TableCell className="text-right">{boy.monthDeliveries}</TableCell>
                    <TableCell className="text-right">{boy.trackedKm.toFixed(1)}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(
                        commission(boy.foodIncomeHandled + boy.groceryIncomeHandled, deliveryCommissionRate),
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      </div>
    </RoleGate>
  );
}

function PartnerIncomeTable({
  title,
  rows,
  commissionRate,
}: {
  title: string;
  rows: PartnerIncome[];
  commissionRate: number;
}) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Badge variant="outline">{rows.length} listings</Badge>
      </div>
      <Table className="mt-4">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Today</TableHead>
            <TableHead className="text-right">Month</TableHead>
            <TableHead className="text-right">Orders</TableHead>
            <TableHead className="text-right">Commission</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                No listings found.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="font-medium">{row.name}</div>
                  <Badge variant={row.is_open ? "default" : "secondary"} className="mt-1">
                    {row.is_open ? "Open" : "Closed"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div>{formatCurrency(row.todayIncome)}</div>
                  <div className="text-xs text-muted-foreground">{row.todayOrders} orders</div>
                </TableCell>
                <TableCell className="text-right">
                  <div>{formatCurrency(row.monthIncome)}</div>
                  <div className="text-xs text-muted-foreground">{row.monthOrders} orders</div>
                </TableCell>
                <TableCell className="text-right">{row.totalOrders}</TableCell>
                <TableCell className="text-right">{formatCurrency(commission(row.monthIncome, commissionRate))}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  );
}
