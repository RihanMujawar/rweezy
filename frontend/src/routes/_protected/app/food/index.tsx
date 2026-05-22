import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Search, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_protected/app/food/")({
  component: FoodList,
});

type Restaurant = {
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

function FoodList() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [location, setLocation] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openOnly, setOpenOnly] = useState(false);

  useEffect(() => {
    api.catalog.getRestaurants().then(({ restaurants: data, location }) => {
      setRestaurants((data as Restaurant[]) ?? []);
      setLocation((location as Location | null) ?? null);
      setLoading(false);
    });
  }, []);

  const filteredRestaurants = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return restaurants.filter((restaurant) => {
      const matchesStatus = !openOnly || restaurant.is_open;
      const haystack = [
        restaurant.name,
        restaurant.description,
        restaurant.address,
        restaurant.town_name,
        restaurant.pincode,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesStatus && (!needle || haystack.includes(needle));
    });
  }, [openOnly, query, restaurants]);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold">Restaurants</h1>
      <p className="text-muted-foreground">
        {location?.town_name && location?.pincode
          ? `Showing restaurants in ${location.town_name} ${location.pincode}.`
          : "Pick a place to order from."}
      </p>

      <div className="mt-6 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search restaurants, cuisines, or areas"
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
      ) : restaurants.length === 0 ? (
        <div className="mt-12 rounded-lg border bg-card p-8 text-center text-muted-foreground">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Store className="h-8 w-8 text-primary" />
          </div>
          <p className="mt-3">
            {location?.town_name && location?.pincode
              ? "No restaurants are available in your town and pincode yet."
              : "No restaurants yet. An admin needs to add some."}
          </p>
          <Button asChild className="mt-4 min-h-11">
            <Link to="/app/grocery">Shop groceries instead</Link>
          </Button>
        </div>
      ) : filteredRestaurants.length === 0 ? (
        <div className="mt-10 rounded-lg border bg-card p-8 text-center">
          <p className="font-medium">No matches found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try another restaurant, cuisine, or area.
          </p>
          <Button variant="outline" className="mt-4 min-h-11" onClick={() => setQuery("")}>
            Clear search
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredRestaurants.map((r) => (
            <Link
              key={r.id}
              to="/app/food/$restaurantId"
              params={{ restaurantId: r.id }}
              className="overflow-hidden rounded-lg border bg-card transition-transform hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="aspect-video animate-pulse bg-muted">
                {r.image_url && (
                  <img src={r.image_url} alt={r.name} className="h-full w-full object-cover" />
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{r.name}</h3>
                  <span
                    className={`text-xs ${r.is_open ? "text-green-600" : "text-muted-foreground"}`}
                  >
                    {r.is_open ? "Open" : "Closed"}
                  </span>
                </div>
                {r.address && <p className="mt-1 text-xs text-muted-foreground">{r.address}</p>}
                {(r.town_name || r.pincode) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[r.town_name, r.pincode].filter(Boolean).join(" ")}
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
