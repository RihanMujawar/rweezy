import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bike,
  BriefcaseBusiness,
  ClipboardList,
  Home,
  Shield,
  ShoppingBasket,
  User,
  UtensilsCrossed,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type AppRole, useAuth } from "@/lib/auth-context";
import { useAppMode } from "@/lib/app-mode-context";
import { motion, AnimatePresence } from "framer-motion";

type MobileNavItem =
  | { type: "link"; title: string; to: string; icon: typeof Home }
  | { type: "action"; title: string; onClick: () => void; icon: typeof Home };

const customerItems: MobileNavItem[] = [
  { type: "link", title: "Home", to: "/app", icon: Home },
  { type: "link", title: "Food", to: "/app/food", icon: UtensilsCrossed },
  { type: "link", title: "Grocery", to: "/app/grocery", icon: ShoppingBasket },
  { type: "link", title: "Ride", to: "/app/ride", icon: Bike },
  { type: "link", title: "Orders", to: "/app/orders", icon: ClipboardList },
  { type: "link", title: "Profile", to: "/app/profile", icon: User },
];

const adminItems: MobileNavItem[] = [
  { type: "link", title: "Admin", to: "/admin", icon: Shield },
  { type: "link", title: "Users", to: "/admin/users", icon: User },
  { type: "link", title: "Restaurants", to: "/admin/restaurants", icon: UtensilsCrossed },
  { type: "link", title: "Grocery", to: "/admin/grocery-stores", icon: ShoppingBasket },
];

const hotelManagerItems: MobileNavItem[] = [
  { type: "link", title: "Menu", to: "/hotel/menu", icon: UtensilsCrossed },
  { type: "link", title: "Orders", to: "/hotel/orders", icon: ClipboardList },
];

const groceryManagerItems: MobileNavItem[] = [
  { type: "link", title: "Items", to: "/grocery-admin/items", icon: ShoppingBasket },
  { type: "link", title: "Orders", to: "/grocery-admin/orders", icon: ClipboardList },
];

const riderItems: MobileNavItem[] = [
  { type: "link", title: "Rides", to: "/rider", icon: Bike },
  { type: "link", title: "Active", to: "/rider/active", icon: ClipboardList },
];

const deliveryItems: MobileNavItem[] = [
  { type: "link", title: "Jobs", to: "/delivery", icon: Bike },
  { type: "link", title: "Active", to: "/delivery/active", icon: ClipboardList },
];
const BUSINESS_ROLES: AppRole[] = [
  "admin",
  "hotel_manager",
  "grocery_manager",
  "delivery_boy",
  "rider",
];

function isActive(pathname: string, to: string) {
  if (to === "/app") return pathname === "/app" || pathname === "/app/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

function pickBusinessItems(pathname: string, roles: string[]) {
  if (pathname.startsWith("/admin") && roles.includes("admin")) return adminItems;
  if (pathname.startsWith("/hotel") && roles.includes("hotel_manager")) return hotelManagerItems;
  if (pathname.startsWith("/grocery-admin") && roles.includes("grocery_manager"))
    return groceryManagerItems;
  if (pathname.startsWith("/delivery") && roles.includes("delivery_boy")) return deliveryItems;
  if (pathname.startsWith("/rider") && roles.includes("rider")) return riderItems;

  if (roles.includes("admin")) return adminItems;
  if (roles.includes("hotel_manager")) return hotelManagerItems;
  if (roles.includes("grocery_manager")) return groceryManagerItems;
  if (roles.includes("delivery_boy")) return deliveryItems;
  if (roles.includes("rider")) return riderItems;
  return [];
}

export function MobileBottomNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { roles } = useAuth();
  const { mode, toggleMode } = useAppMode();

  const hasBusinessMode = roles.some((role) => BUSINESS_ROLES.includes(role));
  const businessItems = pickBusinessItems(pathname, roles);

  const items: MobileNavItem[] =
    mode === "business" && hasBusinessMode
      ? [
          { type: "link", title: "Home", to: "/app", icon: Home },
          ...businessItems,
          { type: "action", title: "Mode", onClick: toggleMode, icon: BriefcaseBusiness },
          { type: "link", title: "Profile", to: "/app/profile", icon: User },
        ]
      : [
          ...customerItems,
          ...(hasBusinessMode
            ? [{ type: "action", title: "Mode", onClick: toggleMode, icon: BriefcaseBusiness }]
            : []),
        ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-6 pb-6 md:hidden pointer-events-none">
      <div
        className={cn(
          "mx-auto grid max-w-md rounded-[2.5rem] border border-white/20 bg-background/50 p-2 shadow-2xl shadow-black/20 backdrop-blur-3xl pointer-events-auto items-center",
          items.length === 5 && "grid-cols-5",
          items.length === 6 && "grid-cols-6",
          items.length === 7 && "grid-cols-7",
        )}
      >
        <AnimatePresence mode="popLayout">
          {items.map((item, idx) => {
            const Icon = item.icon;
            const active = item.type === "link" ? isActive(pathname, item.to) : mode === "business" && item.title === "Mode";
            const key = item.type === "link" ? item.to : `action-${idx}-${item.title}`;

            const commonClass = cn(
              "relative flex h-14 flex-col items-center justify-center gap-1 rounded-[2rem] px-1 transition-all duration-300",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-90",
              active
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            );

            const content = (
              <>
                {active && (
                  <motion.div
                    layoutId="nav-pill"
                    className="absolute inset-0 bg-primary shadow-lg shadow-primary/30 -z-10"
                    style={{ borderRadius: "1.75rem" }}
                    transition={{ type: "spring", bounce: 0.3, duration: 0.6 }}
                  />
                )}
                <Icon className={cn("h-5 w-5 transition-transform", active && "scale-110")} />
                <span className="max-w-full truncate text-[9px] font-bold leading-none uppercase tracking-tighter">
                  {item.title}
                </span>
              </>
            );

            if (item.type === "action") {
              return (
                <button
                  key={key}
                  type="button"
                  onClick={item.onClick}
                  className={commonClass}
                  aria-pressed={active}
                >
                  {content}
                </button>
              );
            }

            return (
              <Link
                key={key}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={commonClass}
              >
                {content}
              </Link>
            );
          })}
        </AnimatePresence>
      </div>
    </nav>
  );
}
