import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  ArrowRight,
  Bike,
  MapPin,
  Package,
  ShoppingBasket,
  Sparkles,
  UtensilsCrossed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrderSummary } from "@/hooks/use-order-summary";
import { OnboardingDialog } from "@/components/onboarding-dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

export const Route = createFileRoute("/_protected/app/")({
  component: AppHome,
});

const bentoActions = [
  {
    to: "/app/food",
    title: "Food",
    desc: "Order meals from nearby restaurants.",
    icon: UtensilsCrossed,
    className: "md:col-span-2 md:row-span-2",
    image:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80",
    meta: "Restaurants near you",
  },
  {
    to: "/app/grocery",
    title: "Grocery",
    desc: "Fresh essentials and daily items.",
    icon: ShoppingBasket,
    className: "md:col-span-1",
    image:
      "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80",
    meta: "Daily essentials",
  },
  {
    to: "/app/ride",
    title: "Ride",
    desc: "Book a bike, auto, or car.",
    icon: Bike,
    className: "md:col-span-1",
    image:
      "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?auto=format&fit=crop&w=900&q=80",
    meta: "Fast pickup",
  },
  {
    to: "/app/package",
    title: "Package",
    desc: "Send parcels across town.",
    icon: Package,
    className: "md:col-span-2",
    image:
      "https://images.unsplash.com/photo-1580674285054-bed31e145f59?auto=format&fit=crop&w=1200&q=80",
    meta: "Doorstep delivery",
  },
];

interface CatalogItem {
  id: string;
  name: string;
  price: number | string;
  image_url?: string | null;
  restaurant_id?: string;
  store_id?: string;
  restaurants?: { name: string } | null;
  grocery_stores?: { name: string } | null;
}

function ItemCarousel({
  title,
  subtitle,
  to,
  items,
  loading,
}: {
  title: string;
  subtitle: string;
  to: "/app/food" | "/app/grocery";
  items: CatalogItem[];
  loading: boolean;
}) {
  return (
    <section className="mt-8 md:mt-10">
      <div className="mb-3 flex items-end justify-between gap-3 md:mb-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold md:text-xl">{title}</h2>
          <p className="hidden text-sm text-muted-foreground sm:block">{subtitle}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to={to}>
            View <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <Carousel opts={{ align: "start", dragFree: true }} className="px-0.5">
        <CarouselContent>
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <CarouselItem key={index} className="basis-[46%] sm:basis-1/2 lg:basis-1/4">
                <div className="overflow-hidden rounded-lg border bg-card p-3 sm:p-4">
                  <div className="aspect-square bg-muted sm:aspect-[4/3] animate-pulse rounded" />
                  <div className="mt-3 space-y-2">
                    <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                    <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                    <div className="h-4 bg-muted animate-pulse rounded w-1/4 mt-2" />
                  </div>
                </div>
              </CarouselItem>
            ))
          ) : items.length === 0 ? (
            <div className="w-full py-10 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
              No items available right now.
            </div>
          ) : (
            items.map((item) => {
              const placeName =
                item.restaurants?.name || item.grocery_stores?.name || "Rweezy Partner";
              const imageUrl =
                item.image_url ||
                (to === "/app/food"
                  ? "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=700&q=80"
                  : "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=700&q=80");
              const linkClassName =
                "block overflow-hidden rounded-xl border bg-card/60 backdrop-blur-md shadow-sm transition-all duration-300 hover:border-primary/50 hover:scale-[1.02] hover:shadow-md";
              const cardBody = (
                <>
                  <div className="aspect-square bg-muted sm:aspect-[4/3]">
                    <img src={imageUrl} alt={item.name} className="h-full w-full object-cover" />
                  </div>
                  <div className="p-3 sm:p-4">
                    <div>
                      <h3 className="line-clamp-2 text-sm font-semibold leading-tight sm:text-base">
                        {item.name}
                      </h3>
                      <p className="mt-1 truncate text-xs text-muted-foreground sm:text-sm">
                        {placeName}
                      </p>
                    </div>
                    <p className="mt-2 text-sm font-semibold">₹{item.price}</p>
                  </div>
                </>
              );

              return (
                <CarouselItem key={item.id} className="basis-[46%] sm:basis-1/2 lg:basis-1/4">
                  {to === "/app/food" ? (
                    <Link
                      to="/app/food/$restaurantId"
                      params={{ restaurantId: item.restaurant_id || "" }}
                      className={linkClassName}
                    >
                      {cardBody}
                    </Link>
                  ) : (
                    <Link
                      to="/app/grocery/$storeId"
                      params={{ storeId: item.store_id || "" }}
                      className={linkClassName}
                    >
                      {cardBody}
                    </Link>
                  )}
                </CarouselItem>
              );
            })
          )}
        </CarouselContent>
        {!loading && items.length > 0 && (
          <>
            <CarouselPrevious className="left-2 hidden bg-background/90 sm:inline-flex" />
            <CarouselNext className="right-2 hidden bg-background/90 sm:inline-flex" />
          </>
        )}
      </Carousel>
    </section>
  );
}

function AppHome() {
  const { user, roles } = useAuth();
  const { latestActiveOrder } = useOrderSummary();
  const [foodItems, setFoodItems] = useState<CatalogItem[]>([]);
  const [groceryItems, setGroceryItems] = useState<CatalogItem[]>([]);
  const [loadingFood, setLoadingFood] = useState(true);
  const [loadingGrocery, setLoadingGrocery] = useState(true);

  useEffect(() => {
    api.catalog
      .getPopularFoodItems()
      .then(({ items }) => {
        setFoodItems(items || []);
      })
      .catch((err) => console.error("Error fetching popular food:", err))
      .finally(() => setLoadingFood(false));

    api.catalog
      .getPopularGroceryItems()
      .then(({ items }) => {
        setGroceryItems(items || []);
      })
      .catch((err) => console.error("Error fetching popular grocery:", err))
      .finally(() => setLoadingGrocery(false));
  }, []);

  return (
    <div className="container mx-auto px-4 py-5 md:py-8">
      {user?.id && <OnboardingDialog userId={user.id} email={user.email} />}
      <div className="mb-5 md:mb-8">
        <h1 className="text-2xl font-bold md:text-3xl">Hello {user?.email?.split("@")[0]} 👋</h1>
        <p className="mt-1 text-sm text-muted-foreground md:text-base">
          What would you like to do today?
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {roles.map((r) => (
            <span key={r} className="rounded-full bg-secondary px-3 py-1 text-xs">
              {r.replace("_", " ")}
            </span>
          ))}
        </div>
      </div>

      {latestActiveOrder && (
        <section className="mb-6 rounded-xl border bg-primary/10 border-primary/20 backdrop-blur-md p-4 shadow-lg shadow-primary/5 relative overflow-hidden animate-pulse">
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-primary/20 rounded-full blur-[40px] pointer-events-none" />
          <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/20">
                <MapPin className="h-5 w-5 text-primary" />
              </span>
              <div>
                <h2 className="font-semibold">Track your active order</h2>
                <p className="text-sm text-muted-foreground">
                  {latestActiveOrder.label} is currently {latestActiveOrder.status}.
                </p>
              </div>
            </div>
            <Button
              asChild
              className="min-h-11 shrink-0 btn-interactive shadow-md shadow-primary/10"
            >
              <Link
                to="/app/track"
                search={{ id: latestActiveOrder.id, kind: latestActiveOrder.kind }}
              >
                Track order <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center gap-2 md:mb-4">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold tracking-tight md:text-xl">
            Book anything from one place
          </h2>
        </div>
        <div className="grid grid-cols-4 gap-2 md:auto-rows-[180px] md:grid-cols-4 md:gap-4">
          {bentoActions.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className={`group relative min-h-20 overflow-hidden rounded-xl liquid-glass-card p-2 md:min-h-0 md:p-5 ${s.className}`}
            >
              <img
                src={s.image}
                alt={`${s.title} service`}
                className="hidden absolute inset-0 h-full w-full object-cover opacity-25 transition duration-500 group-hover:scale-105 group-hover:opacity-40 md:block"
              />
              <div className="hidden absolute inset-0 bg-gradient-to-t from-background/90 via-background/60 to-background/10 md:block" />
              <div className="relative z-10 flex h-full flex-col items-center justify-center gap-2 text-center md:items-stretch md:justify-between md:text-left w-full">
                <div className="flex items-center justify-center md:justify-between gap-3 w-full">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 dark:bg-black/20 border border-white/10 shadow-inner group-hover:scale-110 transition-transform duration-300">
                    <s.icon className="h-5 w-5 text-foreground" />
                  </span>
                  <span className="hidden rounded-md bg-white/10 dark:bg-black/20 border border-white/5 px-2 py-1 text-xs font-semibold md:inline-flex text-muted-foreground">
                    {s.meta}
                  </span>
                </div>
                <div>
                  <h3 className="text-xs font-bold leading-none md:text-2xl md:leading-normal group-hover:translate-x-1 transition-transform duration-300">
                    {s.title}
                  </h3>
                  <p className="mt-1 hidden max-w-sm text-sm text-muted-foreground md:block">
                    {s.desc}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <ItemCarousel
        title="Popular food items"
        subtitle="Quick picks for lunch, dinner, and cravings."
        to="/app/food"
        items={foodItems}
        loading={loadingFood}
      />
      <ItemCarousel
        title="Grocery picks"
        subtitle="Fresh items and home essentials for fast delivery."
        to="/app/grocery"
        items={groceryItems}
        loading={loadingGrocery}
      />
    </div>
  );
}
