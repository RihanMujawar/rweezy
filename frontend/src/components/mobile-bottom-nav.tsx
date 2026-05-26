import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bike,
  ClipboardList,
  Home,
  LifeBuoy,
  ShoppingBasket,
  User,
  UtensilsCrossed,
} from "lucide-react";
import { cn } from "@/lib/utils";

const mobileNavItems = [
  { title: "Home", to: "/app", icon: Home },
  { title: "Food", to: "/app/food", icon: UtensilsCrossed },
  { title: "Grocery", to: "/app/grocery", icon: ShoppingBasket },
  { title: "Ride", to: "/app/ride", icon: Bike },
  { title: "Orders", to: "/app/orders", icon: ClipboardList },
  { title: "Help", to: "/app/support", icon: LifeBuoy },
  { title: "Profile", to: "/app/profile", icon: User },
] as const;

function isActive(pathname: string, to: string) {
  if (to === "/app") return pathname === "/app" || pathname === "/app/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function MobileBottomNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:hidden">
      <div className="mx-auto grid max-w-lg grid-cols-7 rounded-2xl border border-white/25 bg-background/55 p-1.5 shadow-2xl shadow-black/15 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/45">
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.to);

          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-medium text-muted-foreground transition btn-interactive",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-primary/95 text-primary-foreground shadow-lg shadow-primary/25 scale-105"
                  : "hover:bg-white/10 dark:hover:bg-white/5 hover:text-foreground",
              )}
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
