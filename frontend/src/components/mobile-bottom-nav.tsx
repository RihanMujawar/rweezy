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

function isActive(pathname: string, to: string, allItems: MobileNavItem[]) {
  if (to === "/app") return pathname === "/app" || pathname === "/app/";
  const isMatch = pathname === to || pathname.startsWith(`${to}/`);
  if (!isMatch) return false;

  const hasSpecificMatch = allItems.some(
    (item) => item.type === "link" && item.to.length > to.length && pathname.startsWith(item.to)
  );
  return !hasSpecificMatch;
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
        ]
      : [
          ...customerItems,
          ...(hasBusinessMode
            ? [{ type: "action", title: "Business", onClick: toggleMode, icon: BriefcaseBusiness }]
            : []),
        ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:hidden pointer-events-none">
      <div className="mx-auto flex max-w-lg items-center gap-1 rounded-[2rem] border border-white/10 bg-background/80 p-1.5 shadow-2xl backdrop-blur-2xl pointer-events-auto">
        {items.map((item) => {
          const Icon = item.icon;
          const isLink = item.type === "link";
          const active = isLink ? isActive(pathname, item.to, items) : false;
          // The Business button gets a special active state that doesn't use the shared layoutId pill
          const isBusinessActive = item.type === "action" && mode === "business";
          const key = isLink ? item.to : `action-${item.title}`;

          const content = (
            <div
              className={cn(
                "relative flex h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl transition-all duration-300",
                active ? "text-primary-foreground" : "text-foreground/40 hover:text-foreground/70",
                isBusinessActive && !active && "bg-primary/10 text-primary"
              )}
            >
              {active && (
                <motion.div
                  layoutId="mobile-nav-pill"
                  className="absolute inset-0 bg-primary rounded-2xl -z-10 shadow-lg shadow-primary/20"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                />
              )}
              <Icon className={cn("h-5 w-5", active && "scale-110")} />
              <span className="max-w-full truncate text-[8px] font-black leading-none uppercase tracking-tighter">
                {item.title}
              </span>
            </div>
          );

          if (item.type === "action") {
            return (
              <button
                key={key}
                type="button"
                onClick={item.onClick}
                className="flex-1 focus:outline-none"
              >
                {content}
              </button>
            );
          }

          return (
            <Link key={key} to={item.to} className="flex-1 focus:outline-none">
              {content}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
