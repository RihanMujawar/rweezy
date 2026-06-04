import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { RoleGate } from "@/components/coming-soon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/hotel/")({
  component: HotelDashboard,
});

type Restaurant = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  town_name: string | null;
  pincode: string | null;
  image_url: string | null;
  is_open: boolean;
  free_delivery_threshold: number;
  delivery_fee: number;
  packaging_fee: number;
  service_tax_pct: number;
  is_raining: boolean;
  rain_fee: number;
  discount_pct: number;
  discount_flat: number;
  is_bogo_active: boolean;
};

function HotelDashboard() {
  const { user, roles } = useAuth();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [stats, setStats] = useState({ total: 0, pending: 0, today: 0 });
  const [orders, setOrders] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Partial<Restaurant>>({ is_open: true });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const [{ restaurant: r, stats, orders: o }, { partners: p }] = await Promise.all([
        api.hotel.getDashboard(),
        api.hotel.getDeliveryPartners()
    ]);
    setRestaurant((r as Restaurant | null) ?? null);
    if (r) setForm(r as Restaurant);
    setStats(stats);
    setOrders(o || []);
    setPartners(p || []);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!user) return;
    if (!form.name?.trim()) return toast.error("Restaurant name is required");
    setSaving(true);
    const payload = {
      name: form.name,
      description: form.description ?? null,
      address: form.address ?? null,
      town_name: form.town_name ?? null,
      pincode: form.pincode ?? null,
      image_url: form.image_url ?? null,
      is_open: form.is_open ?? true,
      free_delivery_threshold: Number(form.free_delivery_threshold || 0),
      delivery_fee: Number(form.delivery_fee || 0),
      packaging_fee: Number(form.packaging_fee || 0),
      service_tax_pct: Number(form.service_tax_pct || 0),
      is_raining: form.is_raining ?? false,
      rain_fee: Number(form.rain_fee || 0),
      discount_pct: Number(form.discount_pct || 0),
      discount_flat: Number(form.discount_flat || 0),
      is_bogo_active: form.is_bogo_active ?? false,
      manager_id: user.id,
    };
    try {
      await api.hotel.saveRestaurant({
        ...payload,
        id: restaurant?.id,
      });
      toast.success(restaurant ? "Restaurant updated" : "Restaurant created");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save restaurant");
    } finally {
      setSaving(false);
    }
  };

  const assignDelivery = async (orderId: string, deliveryBoyId: string) => {
      try {
          await api.hotel.assignDelivery(orderId, deliveryBoyId);
          toast.success("Delivery partner assigned");
          load();
      } catch (error) {
          toast.error("Failed to assign partner");
      }
  }

  return (
    <RoleGate
      allowed={["hotel_manager", "admin"]}
      hasAny={roles.includes("hotel_manager") || roles.includes("admin")}
    >
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-3xl font-bold">Hotel Management</h1>
        {loading ? (
          <p className="mt-4 text-muted-foreground">Loading dashboard data...</p>
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-3">
            {/* Left Column: Stats and Settings */}
            <div className="lg:col-span-1 space-y-8">
                {restaurant && (
                <div className="grid gap-4 grid-cols-2">
                    <div className="rounded-2xl border bg-card p-6 shadow-sm">
                        <div className="text-sm text-muted-foreground">Total Orders</div>
                        <div className="mt-1 text-3xl font-bold">{stats.total}</div>
                    </div>
                    <div className="rounded-2xl border bg-card p-6 shadow-sm">
                        <div className="text-sm text-muted-foreground">Pending</div>
                        <div className="mt-1 text-3xl font-bold text-primary">{stats.pending}</div>
                    </div>
                </div>
                )}

                <div className="rounded-2xl border bg-card p-6 shadow-sm">
                    <h2 className="text-lg font-semibold mb-4">Store Settings</h2>
                    <div className="space-y-4">
                        <div>
                            <Label>Name</Label>
                            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                        </div>
                        <div className="flex items-center justify-between">
                            <Label>Open for orders</Label>
                            <Switch checked={form.is_open ?? true} onCheckedChange={(v) => setForm({ ...form, is_open: v })} />
                        </div>
                        <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                            <div className="flex flex-col">
                                <Label className="text-blue-700 dark:text-blue-300">It's Raining</Label>
                                <span className="text-xs text-blue-600/70">Applies extra rain fee</span>
                            </div>
                            <Switch checked={form.is_raining ?? false} onCheckedChange={(v) => setForm({ ...form, is_raining: v })} />
                        </div>
                        <hr />
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Free Delivery Over</Label>
                                <Input type="number" value={form.free_delivery_threshold ?? 0} onChange={(e) => setForm({ ...form, free_delivery_threshold: Number(e.target.value) })} />
                            </div>
                            <div>
                                <Label>Delivery Fee</Label>
                                <Input type="number" value={form.delivery_fee ?? 0} onChange={(e) => setForm({ ...form, delivery_fee: Number(e.target.value) })} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Packaging Fee</Label>
                                <Input type="number" value={form.packaging_fee ?? 0} onChange={(e) => setForm({ ...form, packaging_fee: Number(e.target.value) })} />
                            </div>
                            <div>
                                <Label>Rain Fee</Label>
                                <Input type="number" value={form.rain_fee ?? 0} onChange={(e) => setForm({ ...form, rain_fee: Number(e.target.value) })} />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Discount %</Label>
                                <Input type="number" value={form.discount_pct ?? 0} onChange={(e) => setForm({ ...form, discount_pct: Number(e.target.value) })} />
                            </div>
                            <div>
                                <Label>Flat Discount</Label>
                                <Input type="number" value={form.discount_flat ?? 0} onChange={(e) => setForm({ ...form, discount_flat: Number(e.target.value) })} />
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <Label>BOGO Offer (B1G1)</Label>
                            <Switch checked={form.is_bogo_active ?? false} onCheckedChange={(v) => setForm({ ...form, is_bogo_active: v })} />
                        </div>
                        <Button className="w-full mt-4" onClick={save} disabled={saving}>
                            {saving ? "Saving..." : "Save All Settings"}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Middle Column: Active Orders */}
            <div className="lg:col-span-2 space-y-8">
                <div className="rounded-2xl border bg-card overflow-hidden shadow-sm">
                    <div className="p-6 border-b bg-muted/30">
                        <h2 className="text-lg font-semibold">Active Orders & Delivery Management</h2>
                    </div>
                    <div className="divide-y">
                        {orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').map(order => (
                            <div key={order.id} className="p-6 hover:bg-muted/10 transition-colors">
                                <div className="flex justify-between items-start mb-4">
                                    <div>
                                        <div className="font-bold text-lg">Order #{order.id.slice(0, 8)}</div>
                                        <div className="text-sm text-muted-foreground">{new Date(order.created_at).toLocaleString()}</div>
                                        <div className="mt-1 font-medium">₹{order.total}</div>
                                    </div>
                                    <div className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider">
                                        {order.status}
                                    </div>
                                </div>

                                {!order.delivery_boy_id && order.status === 'pending' && (
                                    <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-950/20 rounded-2xl border border-orange-100 dark:border-orange-900/30">
                                        <div className="text-sm font-semibold text-orange-800 dark:text-orange-400 mb-3">Assign Delivery Partner</div>
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            {partners.map(partner => (
                                                <Button
                                                    key={partner.id}
                                                    variant="outline"
                                                    size="sm"
                                                    className="justify-between h-auto py-2 px-3 border-orange-200 hover:bg-orange-100 dark:border-orange-800 dark:hover:bg-orange-900/40"
                                                    onClick={() => assignDelivery(order.id, partner.id)}
                                                >
                                                    <div className="text-left">
                                                        <div className="font-semibold text-xs">{partner.name}</div>
                                                        <div className="text-[10px] opacity-70">{partner.status} • {partner.activeCount} active</div>
                                                    </div>
                                                    <span className="text-[10px] font-bold">ASSIGN</span>
                                                </Button>
                                            ))}
                                            {partners.length === 0 && <p className="text-xs text-orange-600/70 italic">No delivery partners online</p>}
                                        </div>
                                    </div>
                                )}

                                {order.delivery_boy_id && (
                                    <div className="mt-4 flex items-center gap-3 p-3 bg-muted rounded-xl">
                                        <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
                                            {partners.find(p => p.id === order.delivery_boy_id)?.name?.[0] || 'D'}
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-xs font-semibold">Assigned Partner</div>
                                            <div className="text-sm">{partners.find(p => p.id === order.delivery_boy_id)?.name || 'Unknown Partner'}</div>
                                        </div>
                                        <div className="text-xs px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-lg font-bold">
                                            TRACKING
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                        {orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length === 0 && (
                            <div className="p-12 text-center text-muted-foreground italic">
                                No active orders at the moment.
                            </div>
                        )}
                    </div>
                </div>
            </div>
          </div>
        )}
      </div>
    </RoleGate>
  );
}
