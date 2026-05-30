import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Minus, Search, ShoppingBasket, ShoppingCart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useGroceryCart } from "@/lib/grocery-cart";
import { toast } from "sonner";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/app/grocery/$storeId")({
  component: StorePage,
});

type Store = { id: string; name: string; description: string | null; image_url: string | null };
type Item = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category: string | null;
  is_available: boolean;
};

function StorePage() {
  const { storeId } = Route.useParams();
  const navigate = useNavigate();
  const cart = useGroceryCart();
  const [store, setStore] = useState<Store | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.catalog.getStore(storeId).then(({ store, items }) => {
      setStore((store as Store | null) ?? null);
      setItems((items as Item[]) ?? []);
      setLoading(false);
    });
  }, [storeId]);

  const itemQty = (id: string) => cart.items.find((i) => i.id === id)?.quantity ?? 0;

  const addItem = (item: Item) => {
    if (cart.storeId && cart.storeId !== storeId) {
      toast.message("Cart cleared", {
        description: "You can only order from one store at a time.",
      });
    }
    cart.add({ id: item.id, name: item.name, price: Number(item.price), storeId });
  };

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const haystack = [item.name, item.description, item.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return item.is_available && (!needle || haystack.includes(needle));
    });
  }, [items, query]);

  if (loading) {
    return (
      <div className="container mx-auto space-y-4 px-4 py-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (!store) return <div className="p-8">Store not found.</div>;

  const cartCount = cart.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="container mx-auto px-4 py-8">
      <Link to="/app/grocery" className="text-sm text-muted-foreground hover:underline">
        ← All stores
      </Link>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{store.name}</h1>
          {store.description && <p className="text-muted-foreground">{store.description}</p>}
        </div>
        {cartCount > 0 && cart.storeId === storeId && (
          <Button className="min-h-11" onClick={() => navigate({ to: "/app/grocery/checkout" })}>
            <ShoppingCart className="mr-2 h-4 w-4" /> Cart ({cartCount}) — $
            {cart.total().toFixed(2)}
          </Button>
        )}
      </div>
      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search grocery items"
          className="min-h-11 pl-9"
        />
      </div>

      <div className="mt-6 grid gap-3">
        {items.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            <ShoppingBasket className="mx-auto h-8 w-8" />
            <p className="mt-2">No items available right now.</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center">
            <p className="font-medium">No item matches</p>
            <Button variant="outline" className="mt-4 min-h-11" onClick={() => setQuery("")}>
              Clear search
            </Button>
          </div>
        ) : (
          filteredItems.map((item) => {
            const qty = itemQty(item.id);
            return (
              <div key={item.id} className="flex items-center gap-4 rounded-xl border bg-card p-4">
                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                  {item.image_url && (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="h-full w-full object-cover"
                    />
                  )}
                  <span className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-1 py-0.5 text-[10px] text-white">
                    {store.name}
                  </span>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">{item.name}</h3>
                  {item.category && (
                    <p className="text-xs text-muted-foreground">{item.category}</p>
                  )}
                  {item.description && (
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  )}
                  <p className="mt-1 font-medium">${Number(item.price).toFixed(2)}</p>
                </div>
                {qty === 0 ? (
                  <Button size="sm" className="min-h-11" onClick={() => addItem(item)}>
                    Add
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-11 w-11"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => cart.setQty(item.id, qty - 1)}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-6 text-center">{qty}</span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-11 w-11"
                      aria-label={`Add ${item.name}`}
                      onClick={() => cart.setQty(item.id, qty + 1)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
