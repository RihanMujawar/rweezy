import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "@/lib/location-context";
import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import {
  ArrowRight,
  Bike,
  MapPin,
  Package,
  ShoppingBasket,
  Sparkles,
  UtensilsCrossed,
  Search as SearchIcon,
  Navigation,
  Loader2,
  ChevronRight,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOrderSummary } from "@/hooks/use-order-summary";
import { OnboardingDialog } from "@/components/onboarding-dialog";
import { ManualLocationDialog } from "@/components/manual-location-dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_protected/app/")({
  component: AppHome,
});

const bentoActions = [
  {
    to: "/app/food",
    title: "Food Delivery",
    desc: "Gourmet meals from top-rated local kitchens.",
    icon: UtensilsCrossed,
    className: "md:col-span-2 md:row-span-2",
    image:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80",
    meta: "Quick Bites",
    color: "from-orange-500/20 to-red-500/20",
  },
  {
    to: "/app/grocery",
    title: "Groceries",
    desc: "Daily essentials at your doorstep.",
    icon: ShoppingBasket,
    className: "md:col-span-2",
    image:
      "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80",
    meta: "Fresh Daily",
    color: "from-emerald-500/20 to-teal-500/20",
  },
  {
    to: "/app/ride",
    title: "Quick Ride",
    desc: "Bikes & Cars in minutes.",
    icon: Bike,
    className: "md:col-span-1",
    image:
      "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?auto=format&fit=crop&w=900&q=80",
    meta: "Safe Travel",
    color: "from-blue-500/20 to-indigo-500/20",
  },
  {
    to: "/app/package",
    title: "Courier",
    desc: "Send anything, anywhere.",
    icon: Package,
    className: "md:col-span-1",
    image:
      "https://images.unsplash.com/photo-1580674285054-bed31e145f59?auto=format&fit=crop&w=1200&q=80",
    meta: "Fast Link",
    color: "from-purple-500/20 to-pink-500/20",
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
  category?: string;
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
    <section className="mt-12">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Trending Now</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button asChild variant="ghost" className="group shrink-0 hover:bg-primary/5">
          <Link to={to}>
            Explore all <ChevronRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </Button>
      </div>

      <Carousel opts={{ align: "start", dragFree: true }} className="px-0.5">
        <CarouselContent className="-ml-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <CarouselItem key={index} className="pl-4 basis-[70%] sm:basis-1/2 lg:basis-1/4">
                <div className="overflow-hidden rounded-2xl border bg-card/30 backdrop-blur-sm p-3">
                  <div className="aspect-[4/3] bg-muted animate-pulse rounded-xl" />
                  <div className="mt-4 space-y-3">
                    <div className="h-5 bg-muted animate-pulse rounded-md w-3/4" />
                    <div className="h-4 bg-muted animate-pulse rounded-md w-1/2" />
                    <div className="flex justify-between items-center mt-4">
                        <div className="h-6 bg-muted animate-pulse rounded-md w-1/4" />
                        <div className="h-8 bg-muted animate-pulse rounded-full w-1/4" />
                    </div>
                  </div>
                </div>
              </CarouselItem>
            ))
          ) : items.length === 0 ? (
            <div className="w-full py-16 text-center text-sm text-muted-foreground border border-dashed rounded-2xl bg-card/10 backdrop-blur-sm mx-4">
              <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-20" />
              No items available in your current area.
            </div>
          ) : (
            items.map((item, index) => {
              const placeName =
                item.restaurants?.name || item.grocery_stores?.name || "Rweezy Partner";
              const imageUrl =
                item.image_url ||
                (to === "/app/food"
                  ? "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=700&q=80"
                  : "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=700&q=80");

              return (
                <CarouselItem key={item.id} className="pl-4 basis-[70%] sm:basis-1/2 lg:basis-1/4">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Link
                      to={to === "/app/food" ? "/app/food/$restaurantId" : "/app/grocery/$storeId"}
                      params={to === "/app/food" ? { restaurantId: item.restaurant_id || "" } : { storeId: item.store_id || "" }}
                      className="group block overflow-hidden rounded-2xl border bg-card/40 backdrop-blur-xl shadow-sm transition-all duration-500 hover:border-primary/30 hover:shadow-2xl hover:shadow-primary/5 hover:-translate-y-1"
                    >
                      <div className="relative aspect-[4/3] overflow-hidden">
                        <img
                            src={imageUrl}
                            alt={item.name}
                            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                        {item.category && (
                            <Badge className="absolute top-3 left-3 bg-white/10 backdrop-blur-md border-white/20 text-white font-medium">
                                {item.category}
                            </Badge>
                        )}
                      </div>
                      <div className="p-4">
                        <h3 className="line-clamp-1 text-base font-bold leading-tight group-hover:text-primary transition-colors">
                            {item.name}
                        </h3>
                        <p className="mt-1 truncate text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {placeName}
                        </p>
                        <div className="mt-4 flex items-center justify-between">
                            <span className="text-lg font-black tracking-tight">₹{item.price}</span>
                            <Button size="sm" className="rounded-full h-8 px-4 bg-primary text-primary-foreground opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                                Add
                            </Button>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                </CarouselItem>
              );
            })
          )}
        </CarouselContent>
        {!loading && items.length > 0 && (
          <div className="hidden sm:block">
            <CarouselPrevious className="left-4 bg-background/80 backdrop-blur-md border-border/50" />
            <CarouselNext className="right-4 bg-background/80 backdrop-blur-md border-border/50" />
          </div>
        )}
      </Carousel>
    </section>
  );
}

function AppHome() {
  const { user, roles } = useAuth();
  const {
    location,
    address,
    detectLocation,
    loading: detecting,
    needsManualEntry,
    setNeedsManualEntry,
  } = useLocation();
  const { latestActiveOrder } = useOrderSummary();
  const [foodItems, setFoodItems] = useState<CatalogItem[]>([]);
  const [groceryItems, setGroceryItems] = useState<CatalogItem[]>([]);
  const [loadingFood, setLoadingFood] = useState(true);
  const [loadingGrocery, setLoadingGrocery] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = (loc?: { lat: number; lng: number }) => {
    setLoadingFood(true);
    setLoadingGrocery(true);

    api.catalog
      .getPopularFoodItems(loc ? { ...loc, townName: address } : undefined)
      .then(({ items }) => setFoodItems(items || []))
      .catch((err) => console.error("Error fetching food:", err))
      .finally(() => setLoadingFood(false));

    api.catalog
      .getPopularGroceryItems(loc)
      .then(({ items }) => setGroceryItems(items || []))
      .catch((err) => console.error("Error fetching grocery:", err))
      .finally(() => setLoadingGrocery(false));
  };

  useEffect(() => {
    if (!location && !detecting) {
      detectLocation().catch(() => {
        // Error handled in detectLocation (sets needsManualEntry)
      });
    }
  }, []);

  useEffect(() => {
    fetchData(location || undefined);
  }, [location, address]);

  const handleDetectLocation = async () => {
    try {
      await detectLocation();
      toast.success("Location updated successfully!");
    } catch (err) {
      toast.error("Failed to detect location. Please enable GPS.");
    }
  };

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  }, []);

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="container mx-auto px-4 py-6 md:py-10">
        {user?.id && <OnboardingDialog userId={user.id} email={user.email} />}
        <ManualLocationDialog open={needsManualEntry} onOpenChange={setNeedsManualEntry} />

        {/* Header Section */}
        <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-1"
          >
            <h1 className="text-3xl font-black tracking-tight md:text-5xl lg:text-6xl bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              {greeting}, {user?.email?.split("@")[0] || "User"}
            </h1>
            <div className="flex items-center gap-2 text-muted-foreground">
                <Navigation className="h-4 w-4 text-primary" />
                <button
                    onClick={() => setNeedsManualEntry(true)}
                    disabled={detecting}
                    className="text-sm font-medium hover:text-primary transition-colors flex items-center gap-1 group"
                >
                    {detecting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <span className="max-w-[200px] truncate">{address || "Set location for better results"}</span>
                    )}
                    <ChevronRight className="h-3 w-3 opacity-50 group-hover:translate-x-0.5 transition-transform" />
                </button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex gap-2"
          >
            {roles.map((r) => (
              <Badge key={r} variant="secondary" className="px-3 py-1 rounded-full bg-primary/5 border-primary/10 text-primary font-bold lowercase tracking-tight">
                {r.replace("_", " ")}
              </Badge>
            ))}
          </motion.div>
        </div>

        {/* Search Bar Overlay */}
        <div className="relative mb-12 group">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 to-primary/5 rounded-2xl blur opacity-25 group-focus-within:opacity-100 transition duration-500" />
            <div className="relative flex items-center glass-panel rounded-2xl px-4 py-1 border-primary/10">
                <SearchIcon className="h-5 w-5 text-muted-foreground" />
                <Input
                    placeholder="Search for restaurants, dishes, or groceries..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="border-0 bg-transparent focus-visible:ring-0 text-lg h-14 placeholder:text-muted-foreground/50"
                />
                <Button size="icon" variant="ghost" className="rounded-xl hover:bg-primary/10">
                    <ArrowRight className="h-5 w-5" />
                </Button>
            </div>
        </div>

        <AnimatePresence>
            {latestActiveOrder && (
                <motion.section
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: "auto", marginBottom: 32 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    className="overflow-hidden"
                >
                    <Link
                        to="/app/track"
                        search={{ id: latestActiveOrder.id, kind: latestActiveOrder.kind }}
                        className="group block relative rounded-3xl border border-primary/20 bg-primary/5 backdrop-blur-2xl p-6 transition-all hover:bg-primary/10"
                    >
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                            <MapPin className="h-24 w-24 -rotate-12" />
                        </div>
                        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                            <div className="flex items-center gap-5">
                                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20 animate-pulse">
                                    <MapPin className="h-8 w-8 text-primary-foreground" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold tracking-tight">Active {latestActiveOrder.kind}</h2>
                                    <p className="text-primary/70 font-medium">
                                        {latestActiveOrder.label} is {latestActiveOrder.status}
                                    </p>
                                </div>
                            </div>
                            <Button className="rounded-2xl h-12 px-8 font-bold shadow-xl shadow-primary/10 group-hover:scale-105 transition-transform">
                                Track Now <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                        </div>
                    </Link>
                </motion.section>
            )}
        </AnimatePresence>

        {/* Services Grid */}
        <section>
          <div className="mb-6 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold tracking-tight">Super Services</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {bentoActions.map((s, idx) => (
              <motion.div
                key={s.to}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
                className={s.className}
              >
                <Link
                  to={s.to}
                  className={`group relative h-full min-h-[160px] overflow-hidden rounded-3xl border border-white/10 glass-panel p-6 flex flex-col justify-between transition-all duration-500 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${s.color} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                  <img
                    src={s.image}
                    alt={s.title}
                    className="absolute inset-0 h-full w-full object-cover opacity-10 group-hover:scale-110 transition-transform duration-700"
                  />
                  <div className="relative z-10 flex justify-between items-start">
                    <div className="h-12 w-12 rounded-2xl bg-foreground/5 backdrop-blur-xl border border-white/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                      <s.icon className="h-6 w-6" />
                    </div>
                    <Badge variant="outline" className="bg-white/5 border-white/10 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity">
                        {s.meta}
                    </Badge>
                  </div>
                  <div className="relative z-10 mt-auto">
                    <h3 className="text-xl font-black leading-tight tracking-tight mb-1">{s.title}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all duration-500">
                        {s.desc}
                    </p>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Featured Content */}
        <ItemCarousel
          title="Top Rated Cuisines"
          subtitle="Discover the best meals around you, delivered fresh."
          to="/app/food"
          items={foodItems}
          loading={loadingFood}
        />
        <ItemCarousel
          title="Essentials & More"
          subtitle="Daily groceries and household needs, instantly."
          to="/app/grocery"
          items={groceryItems}
          loading={loadingGrocery}
        />
      </div>
    </div>
  );
}
