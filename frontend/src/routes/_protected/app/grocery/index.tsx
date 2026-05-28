import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Search, ShoppingBasket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_protected/app/grocery/")({
  component: GroceryStores,
});

type Store = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  town_name: string | null;
  pincode: string | null;
  image_url: string | null;
  is_open: boolean;
};

type Location = {
  town_name?: string | null;
  pincode?: string | null;
};

function GroceryStores() {
  const [stores, setStores] = useState<Store[]>([]);
  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openOnly, setOpenOnly] = useState(false);

  useEffect(() => {
    api.catalog.getStores().then(({ stores: data, location }) => {
      setStores((data as Store[]) ?? []);
      setLocation((location as Location | null) ?? null);
      setLoading(false);
    });
  }, []);

  const filteredStores = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return stores.filter((store) => {
      const matchesStatus = !openOnly || store.is_open;
      const haystack = [
        store.name,
        store.description,
        store.address,
        store.town_name,
        store.pincode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesStatus && (!needle || haystack.includes(needle));
    });
  }, [openOnly, query, stores]);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold">Grocery stores</h1>
      <p className="text-muted-foreground">
        {location?.town_name && location?.pincode
          ? `Showing stores in ${location.town_name} ${location.pincode}.`
          : "Order daily essentials."}
      </p>

      <div className="mt-6 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search stores, essentials, or areas"
            className="min-h-11 pl-9"
          />
        </div>
        <Button
          type="button"
          variant={openOnly ? "default" : "outline"}
          className="min-h-11"
          onClick={() => setOpenOnly((value) => !value)}
        >
          Open now
        </Button>
      </div>

      {loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-lg border bg-card">
              <Skeleton className="aspect-video w-full" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : stores.length === 0 ? (
        <div className="mt-12 rounded-lg border bg-card p-8 text-center text-muted-foreground">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <ShoppingBasket className="h-8 w-8 text-primary" />
          </div>
          <p className="mt-3">
            {location?.town_name && location?.pincode
              ? "No grocery stores are available in your town and pincode yet."
              : "No stores yet."}
          </p>
          <Button asChild className="mt-4 min-h-11">
            <Link to="/app/food">Order food instead</Link>
          </Button>
        </div>
      ) : filteredStores.length === 0 ? (
        <div className="mt-10 rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">No matches found</p>
          <p className="mt-1 text-sm text-muted-foreground">Try another store, item, or area.</p>
          <Button variant="outline" className="mt-4 min-h-11" onClick={() => setQuery("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredStores.map((s) => (
            <Link
              key={s.id}
              to="/app/grocery/$storeId"
              params={{ storeId: s.id }}
              className="overflow-hidden rounded-lg border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="aspect-video bg-muted">
                {s.image_url && (
                  <img src={s.image_url} alt={s.name} className="h-full w-full object-cover" />
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{s.name}</h3>
                  <span
                    className={`text-xs ${s.is_open ? "text-green-600" : "text-muted-foreground"}`}
                  >
                    {s.is_open ? "Open" : "Closed"}
                  </span>
                </div>
                {s.address && <p className="mt-1 text-xs text-muted-foreground">{s.address}</p>}
                {(s.town_name || s.pincode) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[s.town_name, s.pincode].filter(Boolean).join(" ")}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
