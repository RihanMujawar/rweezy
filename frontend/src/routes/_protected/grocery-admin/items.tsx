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

export const Route = createFileRoute("/_protected/grocery-admin/items")({
  component: GroceryItems,
});

type Item = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  image_url: string | null;
  is_available: boolean;
  store_id: string;
};

function GroceryItems() {
  const { user, roles } = useAuth();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Item> | null>(null);
  const [open, setOpen] = useState(false);

  const load = async (sid: string) => {
    const { storeId, items } = await api.groceryAdmin.getItems();
    if (storeId) setStoreId(storeId);
    setItems((items as Item[]) ?? []);
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { storeId, items } = await api.groceryAdmin.getItems();
      if (storeId) {
        setStoreId(storeId);
        setItems((items as Item[]) ?? []);
      }
      setLoading(false);
    })();
  }, [user]);

  const save = async () => {
    if (!editing || !storeId) return;
    if (!editing.name || editing.price === undefined) {
      toast.error("Name and price are required");
      return;
    }
    const payload = {
      store_id: storeId,
      name: editing.name,
      description: editing.description ?? null,
      price: Number(editing.price),
      category: editing.category ?? null,
      image_url: editing.image_url ?? null,
      is_available: editing.is_available ?? true,
    };
    try {
      if (editing.id) await api.groceryAdmin.updateItem(editing.id, payload);
      else await api.groceryAdmin.createItem(payload);
      toast.success("Saved");
      setOpen(false);
      setEditing(null);
      if (storeId) load(storeId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save item");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this item?")) return;
    try {
      await api.groceryAdmin.deleteItem(id);
      toast.success("Deleted");
      if (storeId) load(storeId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete item");
    }
  };

  const toggle = async (item: Item) => {
    try {
      await api.groceryAdmin.toggleItem(item.id, !item.is_available);
      if (storeId) load(storeId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update item");
    }
  };

  return (
    <RoleGate allowed={["grocery_manager", "admin"]} hasAny={roles.includes("grocery_manager") || roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Items</h1>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing({ is_available: true })} disabled={!storeId}>
                <Plus className="mr-2 h-4 w-4" /> Add item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing?.id ? "Edit item" : "New item"}</DialogTitle></DialogHeader>
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
                <Button onClick={save} className="w-full">Save</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <p className="mt-4 text-muted-foreground">Loading...</p>
        ) : !storeId ? (
          <p className="mt-4 text-muted-foreground">No store yet. Create one in Store dashboard first.</p>
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
                  <h3 className="font-semibold">{item.name}</h3>
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
