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
    <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:hidden">
      <div
        className={cn(
          "mx-auto grid max-w-lg rounded-2xl border border-white/25 bg-background/55 p-1.5 shadow-2xl shadow-black/15 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/45",
          items.length === 5 && "grid-cols-5",
          items.length === 6 && "grid-cols-6",
          items.length === 7 && "grid-cols-7",
        )}
      >
        {items.map((item, idx) => {
          const Icon = item.icon;
          const active = item.type === "link" ? isActive(pathname, item.to) : mode === "business";
          const key = item.type === "link" ? item.to : `action-${idx}-${item.title}`;

          const commonClass = cn(
            "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium text-muted-foreground transition btn-interactive",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active
              ? "bg-primary/95 text-primary-foreground shadow-lg shadow-primary/25 scale-105"
              : "hover:bg-white/10 dark:hover:bg-white/5 hover:text-foreground",
          );

          if (item.type === "action") {
            return (
              <button
                key={key}
                type="button"
                onClick={item.onClick}
                className={commonClass}
                aria-pressed={mode === "business"}
              >
                <Icon className="h-5 w-5" />
                <span className="max-w-full truncate text-[9px] leading-none sm:text-[10px]">
                  {item.title}
                </span>
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
              <Icon className="h-5 w-5" />
              <span className="max-w-full truncate text-[9px] leading-none sm:text-[10px]">
                {item.title}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
