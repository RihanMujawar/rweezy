import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, AlertTriangle, PackagePlus } from "lucide-react";
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
  stock_quantity?: number;
  low_stock_threshold?: number;
  expiry_date?: string | null;
  aisle_location?: string | null;
};

function GroceryItems() {
  const { user, roles } = useAuth();
  const [storeId, setStoreId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Item> | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [pricePercent, setPricePercent] = useState(10);

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
      stock_quantity: Number(editing.stock_quantity ?? 0),
      low_stock_threshold: Number(editing.low_stock_threshold ?? 5),
      expiry_date: editing.expiry_date || null,
      aisle_location: editing.aisle_location ?? null,
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

  const categories = Array.from(
    new Set(items.map((item) => item.category).filter(Boolean) as string[]),
  );
  const visibleItems =
    categoryFilter === "all" ? items : items.filter((item) => item.category === categoryFilter);
  const selectedItems = visibleItems.filter((item) => selected.has(item.id));
  const lowStockItems = items.filter(
    (item) => Number(item.stock_quantity ?? 0) <= Number(item.low_stock_threshold ?? 5),
  );

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkAdjustPrices = async () => {
    const targets = selectedItems.length > 0 ? selectedItems : visibleItems;
    if (targets.length === 0) return toast.error("No items to update");
    const factor = 1 + pricePercent / 100;
    await Promise.all(
      targets.map((item) =>
        api.groceryAdmin.updateItem(item.id, {
          price: Number((Number(item.price) * factor).toFixed(2)),
        }),
      ),
    );
    toast.success(`Updated ${targets.length} price${targets.length > 1 ? "s" : ""}`);
    setSelected(new Set());
    if (storeId) load(storeId);
  };

  const restockSelected = async () => {
    if (selectedItems.length === 0) return toast.error("Select items first");
    await Promise.all(
      selectedItems.map((item) =>
        api.groceryAdmin.updateItem(item.id, {
          stock_quantity: Math.max(
            Number(item.stock_quantity ?? 0),
            Number(item.low_stock_threshold ?? 5) * 2,
          ),
          is_available: true,
        }),
      ),
    );
    toast.success("Restock suggestions applied");
    setSelected(new Set());
    if (storeId) load(storeId);
  };

  return (
    <RoleGate
      allowed={["grocery_manager", "admin"]}
      hasAny={roles.includes("grocery_manager") || roles.includes("admin")}
    >
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Items</h1>
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) setEditing(null);
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={() => setEditing({ is_available: true })} disabled={!storeId}>
                <Plus className="mr-2 h-4 w-4" /> Add item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing?.id ? "Edit item" : "New item"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={editing?.name ?? ""}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={editing?.description ?? ""}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Price</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={editing?.price ?? ""}
                      onChange={(e) =>
                        setEditing({ ...editing, price: parseFloat(e.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <Label>Category</Label>
                    <Input
                      value={editing?.category ?? ""}
                      onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label>Image URL</Label>
                  <Input
                    value={editing?.image_url ?? ""}
                    onChange={(e) => setEditing({ ...editing, image_url: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Stock</Label>
                    <Input
                      type="number"
                      value={editing?.stock_quantity ?? 0}
                      onChange={(e) =>
                        setEditing({ ...editing, stock_quantity: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <Label>Low stock alert</Label>
                    <Input
                      type="number"
                      value={editing?.low_stock_threshold ?? 5}
                      onChange={(e) =>
                        setEditing({ ...editing, low_stock_threshold: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Aisle / shelf</Label>
                    <Input
                      value={editing?.aisle_location ?? ""}
                      onChange={(e) => setEditing({ ...editing, aisle_location: e.target.value })}
                      placeholder="Aisle 2, B4"
                    />
                  </div>
                  <div>
                    <Label>Expiry date</Label>
                    <Input
                      type="date"
                      value={editing?.expiry_date ?? ""}
                      onChange={(e) => setEditing({ ...editing, expiry_date: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editing?.is_available ?? true}
                    onCheckedChange={(v) => setEditing({ ...editing, is_available: v })}
                  />
                  <Label>Available</Label>
                </div>
                <Button onClick={save} className="w-full">
                  Save
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <p className="mt-4 text-muted-foreground">Loading...</p>
        ) : !storeId ? (
          <p className="mt-4 text-muted-foreground">
            No store yet. Create one in Store dashboard first.
          </p>
        ) : items.length === 0 ? (
          <p className="mt-8 rounded-2xl border bg-card p-12 text-center text-muted-foreground">
            No items yet.
          </p>
        ) : (
          <>
            {lowStockItems.length > 0 && (
              <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-5 w-5" /> {lowStockItems.length} low stock item
                  {lowStockItems.length > 1 ? "s" : ""}
                </div>
                <p className="mt-1 text-sm">
                  Select items and use restock suggestion to raise them to twice the alert level.
                </p>
              </div>
            )}

            <div className="mt-6 grid gap-3 rounded-lg border bg-card p-4 lg:grid-cols-[1fr_auto]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={categoryFilter === "all" ? "default" : "secondary"}
                  className="cursor-pointer"
                  onClick={() => setCategoryFilter("all")}
                >
                  All
                </Badge>
                {categories.map((category) => (
                  <Badge
                    key={category}
                    variant={categoryFilter === category ? "default" : "secondary"}
                    className="cursor-pointer"
                    onClick={() => setCategoryFilter(category)}
                  >
                    {category}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  value={pricePercent}
                  onChange={(event) => setPricePercent(Number(event.target.value))}
                  className="h-10 w-24"
                  aria-label="Bulk price percentage"
                />
                <Button variant="outline" onClick={bulkAdjustPrices}>
                  Adjust prices %
                </Button>
                <Button variant="outline" onClick={restockSelected}>
                  <PackagePlus className="mr-2 h-4 w-4" /> Restock suggestion
                </Button>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              {visibleItems.map((item) => {
                const lowStock =
                  Number(item.stock_quantity ?? 0) <= Number(item.low_stock_threshold ?? 5);
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 rounded-xl border bg-card p-4"
                  >
                    <Checkbox
                      checked={selected.has(item.id)}
                      onCheckedChange={() => toggleSelected(item.id)}
                      aria-label={`Select ${item.name}`}
                    />
                    <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                      {item.image_url && (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold">{item.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        ₹{Number(item.price).toFixed(2)} {item.category && `· ${item.category}`}{" "}
                        {item.aisle_location && `· ${item.aisle_location}`}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <Badge variant={lowStock ? "destructive" : "secondary"}>
                          Stock {item.stock_quantity ?? 0}
                        </Badge>
                        {item.expiry_date && (
                          <Badge variant="outline">Expires {item.expiry_date}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={item.is_available}
                        onCheckedChange={() => toggle(item)}
                        aria-label={`Toggle ${item.name}`}
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-11 w-11"
                        aria-label={`Edit ${item.name}`}
                        onClick={() => {
                          setEditing(item);
                          setOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-11 w-11"
                        aria-label={`Delete ${item.name}`}
                        onClick={() => del(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </RoleGate>
  );
}
