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

export const Route = createFileRoute("/_protected/grocery-admin/")({
  component: GroceryDashboard,
});

type Store = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  town_name: string | null;
  pincode: string | null;
  image_url: string | null;
  is_open: boolean;
};

function GroceryDashboard() {
  const { user, roles } = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [stats, setStats] = useState({ total: 0, pending: 0, today: 0 });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Partial<Store>>({ is_open: true });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const { store: s, stats } = await api.groceryAdmin.getDashboard();
    setStore((s as Store | null) ?? null);
    if (s) setForm(s as Store);
    setStats(stats);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!user) return;
    if (!form.name?.trim()) return toast.error("Store name is required");
    setSaving(true);
    const payload = {
      name: form.name,
      description: form.description ?? null,
      address: form.address ?? null,
      town_name: form.town_name ?? null,
      pincode: form.pincode ?? null,
      image_url: form.image_url ?? null,
      is_open: form.is_open ?? true,
      manager_id: user.id,
    };
    try {
      await api.groceryAdmin.saveStore({
        ...payload,
        id: store?.id,
      });
      toast.success(store ? "Store updated" : "Store created");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save store");
    } finally {
      setSaving(false);
    }
  };

  return (
    <RoleGate allowed={["grocery_manager", "admin"]} hasAny={roles.includes("grocery_manager") || roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold">Store dashboard</h1>
        {loading ? (
          <p className="mt-4 text-muted-foreground">Loading...</p>
        ) : (
          <>
            {store && (
              <>
                <p className="text-muted-foreground">{store.name}</p>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border bg-card p-6"><div className="text-sm text-muted-foreground">Total orders</div><div className="mt-1 text-3xl font-bold">{stats.total}</div></div>
                  <div className="rounded-2xl border bg-card p-6"><div className="text-sm text-muted-foreground">Active</div><div className="mt-1 text-3xl font-bold">{stats.pending}</div></div>
                  <div className="rounded-2xl border bg-card p-6"><div className="text-sm text-muted-foreground">Today</div><div className="mt-1 text-3xl font-bold">{stats.today}</div></div>
                </div>
              </>
            )}

            <div className="mt-8 rounded-2xl border bg-card p-6">
              <h2 className="text-lg font-semibold">{store ? "Edit your store" : "Create your store"}</h2>
              <p className="text-sm text-muted-foreground">
                {store ? "Update your store details." : "You don't have a store yet. Create one to start adding items."}
              </p>
              <div className="mt-4 space-y-3">
                <div><Label>Name</Label><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Description</Label><Textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                <div><Label>Address</Label><Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>Town name</Label><Input value={form.town_name ?? ""} onChange={(e) => setForm({ ...form, town_name: e.target.value })} /></div>
                  <div><Label>Pincode</Label><Input inputMode="numeric" value={form.pincode ?? ""} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
                </div>
                <div><Label>Image URL</Label><Input value={form.image_url ?? ""} onChange={(e) => setForm({ ...form, image_url: e.target.value })} /></div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.is_open ?? true} onCheckedChange={(v) => setForm({ ...form, is_open: v })} />
                  <Label>Open for orders</Label>
                </div>
                <Button onClick={save} disabled={saving}>{saving ? "Saving..." : store ? "Save changes" : "Create store"}</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </RoleGate>
  );
}
