import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { ShoppingBasket } from "lucide-react";

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

  useEffect(() => {
    api.catalog.getStores().then(({ stores: data, location }) => {
      setStores((data as Store[]) ?? []);
      setLocation((location as Location | null) ?? null);
      setLoading(false);
    });
  }, []);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold">Grocery stores</h1>
      <p className="text-muted-foreground">
        {location?.town_name && location?.pincode
          ? `Showing stores in ${location.town_name} ${location.pincode}.`
          : "Order daily essentials."}
      </p>

      {loading ? (
        <div className="mt-8 text-muted-foreground">Loading...</div>
      ) : stores.length === 0 ? (
        <div className="mt-12 rounded-2xl border bg-card p-12 text-center text-muted-foreground">
          <ShoppingBasket className="mx-auto h-10 w-10" />
          <p className="mt-2">
            {location?.town_name && location?.pincode
              ? "No grocery stores are available in your town and pincode yet."
              : "No stores yet."}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((s) => (
            <Link
              key={s.id}
              to="/app/grocery/$storeId"
              params={{ storeId: s.id }}
              className="overflow-hidden rounded-2xl border bg-card transition-transform hover:-translate-y-1"
            >
              <div className="aspect-video bg-muted">
                {s.image_url && <img src={s.image_url} alt={s.name} className="h-full w-full object-cover" />}
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{s.name}</h3>
                  <span className={`text-xs ${s.is_open ? "text-green-600" : "text-muted-foreground"}`}>
                    {s.is_open ? "Open" : "Closed"}
                  </span>
                </div>
                {s.address && <p className="mt-1 text-xs text-muted-foreground">{s.address}</p>}
                {(s.town_name || s.pincode) && (
                  <p className="mt-1 text-xs text-muted-foreground">{[s.town_name, s.pincode].filter(Boolean).join(" ")}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
