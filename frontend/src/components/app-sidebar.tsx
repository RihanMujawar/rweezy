import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth, type AppRole } from "@/lib/auth-context";
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
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (url: string) => path === url;

  const groups: { label: string; items: NavItem[] }[] = [];
  groups.push({ label: "Customer", items: customerNav });
  if (roles.includes("hotel_manager")) groups.push({ label: "Hotel manager", items: hotelNav });
  if (roles.includes("grocery_manager")) groups.push({ label: "Grocery manager", items: groceryNav });
  if (roles.includes("delivery_boy")) groups.push({ label: "Delivery", items: deliveryNav });
  if (roles.includes("rider")) groups.push({ label: "Rider", items: riderNav });
  if (roles.includes("admin")) groups.push({ label: "Admin", items: adminNav });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/" className="px-2 py-2 text-lg font-bold">Zoomly</Link>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)}>
                      <Link to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="px-2 py-2 text-xs text-muted-foreground truncate">{user?.email}</div>
        <Button variant="ghost" size="sm" onClick={signOut} className="justify-start">
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
