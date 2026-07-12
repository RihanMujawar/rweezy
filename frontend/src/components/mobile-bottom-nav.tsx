import { Link, useRouterState } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
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
          { type: "action", title: "Business", onClick: toggleMode, icon: BriefcaseBusiness },
          { type: "link", title: "Profile", to: "/app/profile", icon: User },
        ]
      : [
          ...customerItems,
          ...(hasBusinessMode
            ? [{ type: "action", title: "Business", onClick: toggleMode, icon: BriefcaseBusiness }]
            : []),
        ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:hidden pointer-events-none">
      <motion.div
        layout
        className={cn(
          "mx-auto grid max-w-lg rounded-3xl border border-white/20 bg-background/60 p-2 shadow-2xl backdrop-blur-3xl pointer-events-auto",
          items.length === 5 && "grid-cols-5",
          items.length === 6 && "grid-cols-6",
          items.length === 7 && "grid-cols-7",
        )}
      >
        <AnimatePresence mode="popLayout">
          {items.map((item, idx) => {
            const Icon = item.icon;
            const active = item.type === "link" ? isActive(pathname, item.to) : mode === "business";
            const key = item.type === "link" ? item.to : `action-${idx}-${item.title}`;

            const content = (
              <motion.div
                key={key}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                whileTap={{ scale: 0.9 }}
                className={cn(
                  "relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1 transition-all duration-300",
                  active ? "text-primary-foreground" : "text-foreground/50 hover:text-foreground/80"
                )}
              >
                {active && (
                  <motion.div
                    layoutId="mobile-nav-active"
                    className="absolute inset-0 bg-primary rounded-2xl -z-10 shadow-lg shadow-primary/30"
                    transition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
                  />
                )}
                <Icon className="h-5 w-5" />
                <span className="max-w-full truncate text-[9px] font-bold leading-none uppercase tracking-tighter">
                  {item.title}
                </span>
              </motion.div>
            );

            if (item.type === "action") {
              return (
                <button
                  key={key}
                  type="button"
                  onClick={item.onClick}
                  className="focus:outline-none"
                  aria-pressed={mode === "business"}
                >
                  {content}
                </button>
              );
            }

            return (
              <Link
                key={key}
                to={item.to}
                className="focus:outline-none"
              >
                {content}
              </Link>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </nav>
  );
}
