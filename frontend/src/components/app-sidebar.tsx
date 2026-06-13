import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth, type AppRole } from "@/lib/auth-context";
import { useAppMode } from "@/lib/app-mode-context";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
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
    <Sidebar collapsible="icon" variant="floating">
      <SidebarHeader>
        <Link
          to="/"
          className="px-4 py-6 text-2xl font-black tracking-tighter bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:text-center"
        >
          <span className="group-data-[collapsible=icon]:hidden">Rweezy</span>
          <span className="hidden group-data-[collapsible=icon]:inline">R.</span>
        </Link>
        {hasBusinessMode && (
          <div className="mx-2 grid grid-cols-2 rounded-2xl bg-white/5 p-1 backdrop-blur-md group-data-[collapsible=icon]:grid-cols-1">
            <Button
              type="button"
              size="sm"
              variant={mode === "customer" ? "secondary" : "ghost"}
              className={cn(
                "h-10 rounded-xl text-xs font-semibold transition-all",
                mode === "customer" && "shadow-sm",
              )}
              onClick={() => setMode("customer")}
            >
              <User className="h-4 w-4 md:mr-1.5" />
              <span className="group-data-[collapsible=icon]:hidden">Customer</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "business" ? "secondary" : "ghost"}
              className={cn(
                "h-10 rounded-xl text-xs font-semibold transition-all",
                mode === "business" && "shadow-sm",
              )}
              onClick={() => setMode("business")}
            >
              <BriefcaseBusiness className="h-4 w-4 md:mr-1.5" />
              <span className="group-data-[collapsible=icon]:hidden">Business</span>
            </Button>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent className="px-2">
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel className="px-4">{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => {
                  const active = isActive(item.url);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                        <Link to={item.url} className="relative overflow-hidden">
                          {active && (
                            <motion.div
                              layoutId="sidebar-active"
                              className="absolute inset-0 bg-primary/10 rounded-xl -z-10"
                              transition={{ type: "spring", bounce: 0.25, duration: 0.5 }}
                            />
                          )}
                          <item.icon
                            className={cn(
                              "transition-transform duration-300",
                              active && "scale-110",
                            )}
                          />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="mb-4 rounded-2xl bg-white/5 p-3 backdrop-blur-sm group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-white font-bold shadow-lg">
              {user?.email?.[0].toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold truncate">{user?.email?.split("@")[0]}</p>
              <p className="text-[11px] text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
        </div>
        <Button
          variant="glass"
          size="sm"
          onClick={signOut}
          className="w-full justify-start rounded-xl group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <LogOut className="mr-2 h-4 w-4 group-data-[collapsible=icon]:mr-0" />
          <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
