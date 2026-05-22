import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
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

const foodItems = [
  {
    name: "Paneer tikka bowl",
    place: "Spice Kitchen",
    price: "₹199",
    image:
      "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=700&q=80",
  },
  {
    name: "Masala dosa",
    place: "South Corner",
    price: "₹129",
    image:
      "https://images.unsplash.com/photo-1668236543090-82eba5ee5976?auto=format&fit=crop&w=700&q=80",
  },
  {
    name: "Veg burger combo",
    place: "Grill House",
    price: "₹179",
    image:
      "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=700&q=80",
  },
  {
    name: "Biryani meal",
    place: "Royal Biryani",
    price: "₹249",
    image:
      "https://images.unsplash.com/photo-1563379091339-03246963d96a?auto=format&fit=crop&w=700&q=80",
  },
];

const groceryItems = [
  {
    name: "Fresh vegetables",
    place: "Green Basket",
    price: "From ₹49",
    image:
      "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=700&q=80",
  },
  {
    name: "Milk and breakfast",
    place: "Daily Mart",
    price: "From ₹35",
    image:
      "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=700&q=80",
  },
  {
    name: "Fruits basket",
    place: "Fresh Point",
    price: "From ₹99",
    image:
      "https://images.unsplash.com/photo-1619566636858-adf3ef46400b?auto=format&fit=crop&w=700&q=80",
  },
  {
    name: "Home essentials",
    place: "Quick Store",
    price: "From ₹79",
    image:
      "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=700&q=80",
  },
];

function ItemCarousel({
  title,
  subtitle,
  to,
  items,
}: {
  title: string;
  subtitle: string;
  to: "/app/food" | "/app/grocery";
  items: typeof foodItems;
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
          {items.map((item) => (
            <CarouselItem key={item.name} className="basis-[46%] sm:basis-1/2 lg:basis-1/4">
              <Link
                to={to}
                className="block overflow-hidden rounded-lg border bg-card transition hover:border-primary/50"
              >
                <div className="aspect-square bg-muted sm:aspect-[4/3]">
                  <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                </div>
                <div className="p-3 sm:p-4">
                  <div>
                    <h3 className="line-clamp-2 text-sm font-semibold leading-tight sm:text-base">
                      {item.name}
                    </h3>
                    <p className="mt-1 truncate text-xs text-muted-foreground sm:text-sm">
                      {item.place}
                    </p>
                  </div>
                  <p className="mt-2 text-sm font-semibold">{item.price}</p>
                </div>
              </Link>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-2 hidden bg-background/90 sm:inline-flex" />
        <CarouselNext className="right-2 hidden bg-background/90 sm:inline-flex" />
      </Carousel>
    </section>
  );
}

function AppHome() {
  const { user, roles } = useAuth();
  const { latestActiveOrder } = useOrderSummary();
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
        <section className="mb-6 rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <MapPin className="h-5 w-5 text-primary" />
              </span>
              <div>
                <h2 className="font-semibold">Track your active order</h2>
                <p className="text-sm text-muted-foreground">
                  {latestActiveOrder.label} is currently {latestActiveOrder.status}.
                </p>
              </div>
            </div>
            <Button asChild className="min-h-11 shrink-0">
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
          <Sparkles className="h-5 w-5" />
          <h2 className="text-lg font-semibold md:text-xl">Book anything from one place</h2>
        </div>
        <div className="grid grid-cols-4 gap-2 md:auto-rows-[180px] md:grid-cols-4 md:gap-4">
          {bentoActions.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className={`group relative min-h-20 overflow-hidden rounded-lg border bg-card p-2 transition hover:border-primary/50 md:min-h-0 md:p-5 ${s.className}`}
            >
              <img
                src={s.image}
                alt={`${s.title} service`}
                className="hidden absolute inset-0 h-full w-full object-cover opacity-30 transition group-hover:scale-105 md:block"
              />
              <div className="hidden absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20 md:block" />
              <div className="relative flex h-full flex-col items-center justify-center gap-2 text-center md:items-stretch md:justify-between md:text-left">
                <div className="flex items-center justify-center md:justify-between gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-secondary md:bg-background/90">
                    <s.icon className="h-5 w-5" />
                  </span>
                  <span className="hidden rounded-md bg-background/90 px-2 py-1 text-xs font-medium md:inline-flex">
                    {s.meta}
                  </span>
                </div>
                <div>
                  <h3 className="text-xs font-semibold leading-none md:text-2xl md:leading-normal">
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
      />
      <ItemCarousel
        title="Grocery picks"
        subtitle="Fresh items and home essentials for fast delivery."
        to="/app/grocery"
        items={groceryItems}
      />
    </div>
  );
}
