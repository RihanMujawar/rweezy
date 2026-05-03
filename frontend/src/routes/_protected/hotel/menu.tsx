import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RoleGate } from "@/components/coming-soon";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/hotel/menu")({
  component: HotelMenu,
});

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  image_url: string | null;
  is_available: boolean;
  is_veg: boolean;
  restaurant_id: string;
};

function HotelMenu() {
  const { user, roles } = useAuth();
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<MenuItem> | null>(null);
  const [open, setOpen] = useState(false);

  const load = async (rid: string) => {
    const { restaurantId, items } = await api.hotel.getMenu();
    if (restaurantId) setRestaurantId(restaurantId);
    setItems((items as MenuItem[]) ?? []);
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { restaurantId, items } = await api.hotel.getMenu();
      if (restaurantId) {
        setRestaurantId(restaurantId);
        setItems((items as MenuItem[]) ?? []);
      }
      setLoading(false);
    })();
  }, [user]);

  const save = async () => {
    if (!editing || !restaurantId) return;
    if (!editing.name || editing.price === undefined) {
      toast.error("Name and price are required");
      return;
    }
    const payload = {
      restaurant_id: restaurantId,
      name: editing.name,
      description: editing.description ?? null,
      price: Number(editing.price),
      category: editing.category ?? null,
      image_url: editing.image_url ?? null,
      is_available: editing.is_available ?? true,
      is_veg: editing.is_veg ?? true,
    };
    try {
      if (editing.id) await api.hotel.updateMenuItem(editing.id, payload);
      else await api.hotel.createMenuItem(payload);
      toast.success("Saved");
      setOpen(false);
      setEditing(null);
      if (restaurantId) load(restaurantId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save item");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this item?")) return;
    try {
      await api.hotel.deleteMenuItem(id);
      toast.success("Deleted");
      if (restaurantId) load(restaurantId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete item");
    }
  };

  const toggle = async (item: MenuItem) => {
    try {
      await api.hotel.toggleMenuItem(item.id, !item.is_available);
      if (restaurantId) load(restaurantId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update item");
    }
  };

  return (
    <RoleGate allowed={["hotel_manager", "admin"]} hasAny={roles.includes("hotel_manager") || roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Menu</h1>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing({ is_available: true, is_veg: true })}>
                <Plus className="mr-2 h-4 w-4" /> Add item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing?.id ? "Edit item" : "New item"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={editing?.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                <div><Label>Description</Label><Textarea value={editing?.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Price</Label><Input type="number" step="0.01" value={editing?.price ?? ""} onChange={(e) => setEditing({ ...editing, price: parseFloat(e.target.value) })} /></div>
                  <div><Label>Category</Label><Input value={editing?.category ?? ""} onChange={(e) => setEditing({ ...editing, category: e.target.value })} /></div>
                </div>
                <div><Label>Image URL</Label><Input value={editing?.image_url ?? ""} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} /></div>
                <div className="flex items-center gap-2">
                  <Switch checked={editing?.is_available ?? true} onCheckedChange={(v) => setEditing({ ...editing, is_available: v })} />
                  <Label>Available</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={editing?.is_veg ?? true} onCheckedChange={(v) => setEditing({ ...editing, is_veg: v })} />
                  <Label>Vegetarian</Label>
                </div>
                <Button onClick={save} className="w-full">Save</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <p className="mt-4 text-muted-foreground">Loading...</p>
        ) : !restaurantId ? (
          <p className="mt-4 text-muted-foreground">No restaurant assigned. Ask an admin.</p>
        ) : items.length === 0 ? (
          <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">No items yet.</p>
        ) : (
          <div className="mt-6 grid gap-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-4 rounded-xl border bg-card p-4">
                <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                  {item.image_url && <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex h-4 w-4 items-center justify-center border ${item.is_veg ? "border-green-600" : "border-red-600"}`}>
                      <span className={`h-2 w-2 rounded-full ${item.is_veg ? "bg-green-600" : "bg-red-600"}`} />
                    </span>
                    <h3 className="font-semibold">{item.name}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">${Number(item.price).toFixed(2)} {item.category && `· ${item.category}`}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={item.is_available} onCheckedChange={() => toggle(item)} />
                  <Button size="icon" variant="outline" onClick={() => { setEditing(item); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="outline" onClick={() => del(item.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </RoleGate>
  );
}
