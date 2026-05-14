import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Minus, ShoppingCart } from "lucide-react";
import { useFoodCart } from "@/lib/food-cart";
import { toast } from "sonner";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/app/food/$restaurantId")({
  component: RestaurantPage,
});

type Restaurant = { id: string; name: string; description: string | null; image_url: string | null };
type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  category: string | null;
  is_available: boolean;
  is_veg: boolean;
};

function RestaurantPage() {
  const { restaurantId } = Route.useParams();
  const navigate = useNavigate();
  const cart = useFoodCart();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.catalog.getRestaurant(restaurantId).then(({ restaurant, items }) => {
      setRestaurant((restaurant as Restaurant | null) ?? null);
      setItems((items as MenuItem[]) ?? []);
      setLoading(false);
    });
  }, [restaurantId]);

  const itemQty = (id: string) => cart.items.find((i) => i.id === id)?.quantity ?? 0;

  const addItem = (item: MenuItem) => {
    if (cart.restaurantId && cart.restaurantId !== restaurantId) {
      toast.message("Cart cleared", { description: "You can only order from one restaurant at a time." });
    }
    cart.add({ id: item.id, name: item.name, price: Number(item.price), restaurantId });
  };

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!restaurant) return <div className="p-8">Restaurant not found.</div>;

  const cartCount = cart.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="container mx-auto px-4 py-8">
      <Link to="/app/food" className="text-sm text-muted-foreground hover:underline">← All restaurants</Link>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{restaurant.name}</h1>
          {restaurant.description && <p className="text-muted-foreground">{restaurant.description}</p>}
        </div>
        {cartCount > 0 && cart.restaurantId === restaurantId && (
          <Button onClick={() => navigate({ to: "/app/food/checkout" })}>
            <ShoppingCart className="mr-2 h-4 w-4" /> Cart ({cartCount}) — ${cart.total().toFixed(2)}
          </Button>
        )}
      </div>

      <div className="mt-6 grid gap-3">
        {items.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
            No items available right now.
          </div>
        ) : (
          items.map((item) => {
            const qty = itemQty(item.id);
            return (
              <div key={item.id} className="flex items-center gap-4 rounded-xl border bg-card p-4">
                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                  {item.image_url && <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />}
                  <span
                    title={item.is_veg ? "Vegetarian" : "Non-Vegetarian"}
                    className={`absolute left-1 top-1 inline-flex h-4 w-4 items-center justify-center border bg-white ${item.is_veg ? "border-green-600" : "border-red-600"}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${item.is_veg ? "bg-green-600" : "bg-red-600"}`} />
                  </span>
                  <span className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-1 py-0.5 text-[10px] text-white">
                    {restaurant.name}
                  </span>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">{item.name}</h3>
                  {item.description && <p className="text-sm text-muted-foreground">{item.description}</p>}
                  <p className="mt-1 font-medium">${Number(item.price).toFixed(2)}</p>
                </div>
                {qty === 0 ? (
                  <Button size="sm" onClick={() => addItem(item)}>Add</Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button size="icon" variant="outline" onClick={() => cart.setQty(item.id, qty - 1)}>
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-6 text-center">{qty}</span>
                    <Button size="icon" variant="outline" onClick={() => cart.setQty(item.id, qty + 1)}>
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
