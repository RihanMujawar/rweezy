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
import { motion } from "framer-motion";

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

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const itemAnim = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

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
    <section className="mt-12">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h2>
          <p className="hidden text-sm text-muted-foreground sm:block">{subtitle}</p>
        </div>
        <Button asChild variant="glass" size="sm" className="shrink-0 rounded-full">
          <Link to={to}>
            View all <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <Carousel opts={{ align: "start", dragFree: true }} className="px-0.5">
        <CarouselContent>
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <CarouselItem key={index} className="basis-[70%] sm:basis-1/2 lg:basis-1/4">
                <div className="overflow-hidden rounded-[2rem] border bg-card/40 p-4 backdrop-blur-md">
                  <div className="aspect-square bg-muted/50 animate-pulse rounded-2xl" />
                  <div className="mt-4 space-y-2">
                    <div className="h-5 bg-muted/50 animate-pulse rounded-full w-3/4" />
                    <div className="h-4 bg-muted/50 animate-pulse rounded-full w-1/2" />
                    <div className="h-6 bg-muted/50 animate-pulse rounded-full w-1/4 mt-4" />
                  </div>
                </div>
              </CarouselItem>
            ))
          ) : items.length === 0 ? (
            <div className="w-full py-16 text-center text-sm text-muted-foreground border border-dashed rounded-[2rem] border-white/10 bg-white/5 backdrop-blur-sm">
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
                "block overflow-hidden rounded-[2rem] border border-white/10 bg-card/40 backdrop-blur-xl shadow-lg transition-all duration-500 hover:border-primary/40 hover:-translate-y-2 hover:shadow-primary/10";
              const cardBody = (
                <>
                  <div className="aspect-square overflow-hidden bg-muted sm:aspect-[4/3]">
                    <img src={imageUrl} alt={item.name} className="h-full w-full object-cover transition-transform duration-700 hover:scale-110" />
                  </div>
                  <div className="p-5">
                    <div>
                      <h3 className="line-clamp-1 text-base font-bold tracking-tight">
                        {item.name}
                      </h3>
                      <p className="mt-1 truncate text-xs font-medium text-muted-foreground uppercase tracking-widest">
                        {placeName}
                      </p>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <p className="text-lg font-black text-primary">₹{item.price}</p>
                      <span className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <ArrowRight className="h-4 w-4 text-primary" />
                      </span>
                    </div>
                  </div>
                </>
              );

              return (
                <CarouselItem key={item.id} className="basis-[70%] sm:basis-1/2 lg:basis-1/4 pb-4">
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
            <CarouselPrevious className="left-2 hidden bg-white/10 border-white/10 backdrop-blur-xl hover:bg-white/20 sm:inline-flex" />
            <CarouselNext className="right-2 hidden bg-white/10 border-white/10 backdrop-blur-xl hover:bg-white/20 sm:inline-flex" />
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
    <div className="container mx-auto px-4 py-8 md:py-12 max-w-7xl">
      {user?.id && <OnboardingDialog userId={user.id} email={user.email} />}

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mb-10"
      >
        <h1 className="text-4xl font-black tracking-tight md:text-5xl lg:text-6xl">
          Hello {user?.email?.split("@")[0]} 👋
        </h1>
        <p className="mt-4 text-lg font-medium text-muted-foreground md:text-xl">
          Experience the future of delivery, today.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {roles.map((r) => (
            <span key={r} className="rounded-full bg-white/10 border border-white/5 px-4 py-1 text-xs font-bold uppercase tracking-widest text-muted-foreground backdrop-blur-md">
              {r.replace("_", " ")}
            </span>
          ))}
        </div>
      </motion.div>

      {latestActiveOrder && (
        <motion.section
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-12 rounded-[2.5rem] border border-primary/30 bg-primary/10 backdrop-blur-2xl p-6 shadow-2xl shadow-primary/20 relative overflow-hidden"
        >
          <div className="absolute -top-10 -right-10 w-48 h-48 bg-primary/30 rounded-full blur-[60px] pointer-events-none" />
          <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-5">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.5rem] bg-primary text-white shadow-xl shadow-primary/40">
                <MapPin className="h-8 w-8" />
              </span>
              <div>
                <h2 className="text-xl font-black">Your order is on the way!</h2>
                <p className="text-primary/70 font-medium">
                  {latestActiveOrder.label} is currently <span className="font-black uppercase">{latestActiveOrder.status}</span>.
                </p>
              </div>
            </div>
            <Button
              asChild
              className="h-14 px-8 rounded-2xl bg-primary text-primary-foreground font-bold shadow-xl shadow-primary/40 hover:scale-105 active:scale-95 transition-all"
            >
              <Link
                to="/app/track"
                search={{ id: latestActiveOrder.id, kind: latestActiveOrder.kind }}
              >
                Track live progress <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </motion.section>
      )}

      <section>
        <div className="mb-8 flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-amber-500/10 flex items-center justify-center backdrop-blur-md border border-amber-500/20">
            <Sparkles className="h-6 w-6 text-amber-500" />
          </div>
          <h2 className="text-2xl font-black tracking-tight md:text-3xl">
            Everything you need
          </h2>
        </div>

        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 gap-3 md:auto-rows-[240px] md:grid-cols-4 md:gap-6"
        >
          {bentoActions.map((s) => (
            <motion.div key={s.to} variants={itemAnim} className={s.className}>
              <Link
                to={s.to}
                className="group relative h-full w-full flex flex-col overflow-hidden rounded-[2.5rem] liquid-glass-card p-6"
              >
                <img
                  src={s.image}
                  alt={`${s.title} service`}
                  className="absolute inset-0 h-full w-full object-cover opacity-10 transition duration-700 group-hover:scale-110 group-hover:opacity-30"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent dark:from-black/5 dark:to-transparent pointer-events-none" />

                <div className="relative z-10 flex h-full flex-col justify-between w-full">
                  <div className="flex items-start justify-between w-full">
                    <span className="inline-flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 backdrop-blur-xl shadow-2xl group-hover:scale-110 transition-transform duration-500">
                      <s.icon className="h-7 w-7 text-foreground" />
                    </span>
                    <span className="rounded-full bg-white/10 border border-white/10 px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground backdrop-blur-md hidden lg:inline-block">
                      {s.meta}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-2xl font-black leading-tight group-hover:translate-x-2 transition-transform duration-500 md:text-3xl">
                      {s.title}
                    </h3>
                    <p className="mt-2 hidden max-w-[200px] text-sm font-medium text-muted-foreground leading-relaxed md:block opacity-0 group-hover:opacity-100 transition-opacity duration-500">
                      {s.desc}
                    </p>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </section>

      <ItemCarousel
        title="Popular now"
        subtitle="The most loved dishes by our community."
        to="/app/food"
        items={foodItems}
        loading={loadingFood}
      />
      <ItemCarousel
        title="Freshly stocked"
        subtitle="Daily essentials delivered in minutes."
        to="/app/grocery"
        items={groceryItems}
        loading={loadingGrocery}
      />
    </div>
  );
}
