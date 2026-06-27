import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth, type AppRole } from "@/lib/auth-context";
import { useAppMode } from "@/lib/app-mode-context";
import { useMemo } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  UtensilsCrossed,
  Bike,
  Package,
  ShoppingBasket,
  User,
  ClipboardList,
  Store,
  Truck,
  Users,
  Shield,
  LogOut,
  BriefcaseBusiness,
  LifeBuoy,
} from "lucide-react";

type NavItem = { title: string; url: string; icon: typeof User; roles?: AppRole[] };

const customerNav: NavItem[] = [
  { title: "Home", url: "/app", icon: LayoutDashboard },
  { title: "Food", url: "/app/food", icon: UtensilsCrossed },
  { title: "Grocery", url: "/app/grocery", icon: ShoppingBasket },
  { title: "Ride", url: "/app/ride", icon: Bike },
  { title: "Package", url: "/app/package", icon: Package },
  { title: "My orders", url: "/app/orders", icon: ClipboardList },
  { title: "Profile", url: "/app/profile", icon: User },
  { title: "Help", url: "/app/support", icon: LifeBuoy },
];

const hotelNav: NavItem[] = [
  { title: "Hotel dashboard", url: "/hotel", icon: LayoutDashboard },
  { title: "Menu", url: "/hotel/menu", icon: UtensilsCrossed },
  { title: "Orders", url: "/hotel/orders", icon: ClipboardList },
];

const groceryNav: NavItem[] = [
  { title: "Store dashboard", url: "/grocery-admin", icon: LayoutDashboard },
  { title: "Items", url: "/grocery-admin/items", icon: ShoppingBasket },
  { title: "Orders", url: "/grocery-admin/orders", icon: ClipboardList },
];

const deliveryNav: NavItem[] = [
  { title: "Available jobs", url: "/delivery", icon: Truck },
  { title: "Active", url: "/delivery/active", icon: ClipboardList },
];

const riderNav: NavItem[] = [
  { title: "Available rides", url: "/rider", icon: Bike },
  { title: "Active", url: "/rider/active", icon: ClipboardList },
];

const adminNav: NavItem[] = [
  { title: "Admin", url: "/admin", icon: Shield },
  { title: "Users", url: "/admin/users", icon: Users },
  { title: "Restaurants", url: "/admin/restaurants", icon: Store },
  { title: "Grocery stores", url: "/admin/grocery-stores", icon: ShoppingBasket },
];

export function AppSidebar() {
  const { roles, user, signOut } = useAuth();
  const { mode, setMode } = useAppMode();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => path === url;
  const businessGroups = useMemo(() => {
    const next: { label: string; items: NavItem[] }[] = [];
    if (roles.includes("hotel_manager")) next.push({ label: "Hotel manager", items: hotelNav });
    if (roles.includes("grocery_manager"))
      next.push({ label: "Grocery manager", items: groceryNav });
    if (roles.includes("delivery_boy")) next.push({ label: "Delivery", items: deliveryNav });
    if (roles.includes("rider")) next.push({ label: "Rider", items: riderNav });
    if (roles.includes("admin")) next.push({ label: "Admin", items: adminNav });
    return next;
  }, [roles]);
  const hasBusinessMode = businessGroups.length > 0;

  const groups: { label: string; items: NavItem[] }[] =
    mode === "business" && hasBusinessMode
      ? businessGroups
      : [{ label: "Customer", items: customerNav }];

  return (
    <Sidebar collapsible="icon" className="border-r border-border/50 bg-sidebar/50 backdrop-blur-2xl">
      <SidebarHeader className="border-b border-border/10 pb-4">
        <Link
          to="/"
          className="px-4 py-3 text-2xl font-black tracking-tighter bg-gradient-to-br from-foreground to-foreground/50 bg-clip-text text-transparent"
        >
          Rweezy
        </Link>
        {hasBusinessMode && (
          <div className="mx-4 grid grid-cols-2 rounded-xl bg-foreground/5 p-1 backdrop-blur-md border border-foreground/5">
            <Button
              type="button"
              size="sm"
              variant={mode === "customer" ? "default" : "ghost"}
              className="h-8 rounded-lg text-xs font-semibold transition-all"
              onClick={() => setMode("customer")}
            >
              <User className="mr-1 h-3 w-3" />
              Customer
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "business" ? "default" : "ghost"}
              className="h-8 rounded-lg text-xs font-semibold transition-all"
              onClick={() => setMode("business")}
            >
              <BriefcaseBusiness className="mr-1 h-3 w-3" />
              Business
            </Button>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent className="px-2">
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel className="px-4 text-[10px] font-bold uppercase tracking-widest text-foreground/40">
              {g.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.url)}
                      className="group relative h-10 px-4 rounded-xl transition-all duration-300 hover:bg-foreground/5 active:scale-95"
                    >
                      <Link to={item.url} className="flex items-center gap-3">
                        <item.icon className={cn(
                          "h-4 w-4 transition-transform duration-300 group-hover:scale-110",
                          isActive(item.url) ? "text-primary-foreground" : "text-foreground/60"
                        )} />
                        <span className={cn(
                          "font-medium tracking-tight",
                          isActive(item.url) ? "text-primary-foreground" : "text-foreground/80"
                        )}>{item.title}</span>
                        {isActive(item.url) && (
                          <motion.div
                            layoutId="active-nav"
                            className="absolute inset-0 bg-primary rounded-xl -z-10 shadow-lg shadow-primary/20"
                            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                          />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-border/10 p-4">
        <div className="mb-4 px-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-foreground/40 mb-1">Signed in as</div>
          <div className="text-sm font-semibold text-foreground/80 truncate">{user?.phone || user?.email}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className="w-full justify-start h-10 rounded-xl hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="mr-3 h-4 w-4" />
          <span className="font-semibold">Sign out</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
