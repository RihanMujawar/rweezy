import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Store } from "lucide-react";

export const Route = createFileRoute("/_protected/app/food/")({
  component: FoodList,
});

type Restaurant = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  image_url: string | null;
  is_open: boolean;
};

function FoodList() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.catalog.getRestaurants().then(({ restaurants: data }) => {
      setRestaurants((data as Restaurant[]) ?? []);
      setLoading(false);
    });
  }, []);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold">Restaurants</h1>
      <p className="text-muted-foreground">Pick a place to order from.</p>

      {loading ? (
        <div className="mt-8 text-muted-foreground">Loading...</div>
      ) : restaurants.length === 0 ? (
        <div className="mt-12 rounded-2xl border bg-card p-12 text-center text-muted-foreground">
          <Store className="mx-auto h-10 w-10" />
          <p className="mt-2">No restaurants yet. An admin needs to add some.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {restaurants.map((r) => (
            <Link
              key={r.id}
              to="/app/food/$restaurantId"
              params={{ restaurantId: r.id }}
              className="overflow-hidden rounded-2xl border bg-card transition-transform hover:-translate-y-1"
            >
              <div className="aspect-video bg-muted">
                {r.image_url && <img src={r.image_url} alt={r.name} className="h-full w-full object-cover" />}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{r.name}</h3>
                  <span className={`text-xs ${r.is_open ? "text-green-600" : "text-muted-foreground"}`}>
                    {r.is_open ? "Open" : "Closed"}
                  </span>
                </div>
                {r.address && <p className="mt-1 text-xs text-muted-foreground">{r.address}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
