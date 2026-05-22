import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RoleGate } from "@/components/coming-soon";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/admin/grocery-stores")({
  component: AdminStores,
});

type Store = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  town_name: string | null;
  pincode: string | null;
  image_url: string | null;
  manager_id: string | null;
  is_open: boolean;
};

function AdminStores() {
  const { roles } = useAuth();
  const [list, setList] = useState<Store[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Store>>({});

  const load = useCallback(async () => {
    const { stores } = await api.admin.getStores();
    setList((stores as Store[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!editing.name) return toast.error("Name required");
    const payload = {
      name: editing.name,
      description: editing.description ?? null,
      address: editing.address ?? null,
      town_name: editing.town_name ?? null,
      pincode: editing.pincode ?? null,
      image_url: editing.image_url ?? null,
      manager_id: editing.manager_id || null,
      is_open: editing.is_open ?? true,
    };
    try {
      if (editing.id) await api.admin.updateStore(editing.id, payload);
      else await api.admin.createStore(payload);
      toast.success("Saved");
      setOpen(false);
      setEditing({});
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save store");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this store and all its items?")) return;
    try {
      await api.admin.deleteStore(id);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete store");
    }
  };

  return (
    <RoleGate allowed={["admin"]} hasAny={roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Grocery stores</h1>
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) setEditing({});
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={() => setEditing({ is_open: true })}>
                <Plus className="mr-2 h-4 w-4" /> Add store
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing.id ? "Edit" : "New"} store</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Name</Label>
                  <Input
                    value={editing.name ?? ""}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={editing.description ?? ""}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Address</Label>
                  <Input
                    value={editing.address ?? ""}
                    onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Town name</Label>
                    <Input
                      value={editing.town_name ?? ""}
                      onChange={(e) => setEditing({ ...editing, town_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Pincode</Label>
                    <Input
                      inputMode="numeric"
                      value={editing.pincode ?? ""}
                      onChange={(e) => setEditing({ ...editing, pincode: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <Label>Image URL</Label>
                  <Input
                    value={editing.image_url ?? ""}
                    onChange={(e) => setEditing({ ...editing, image_url: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Manager user ID</Label>
                  <Input
                    value={editing.manager_id ?? ""}
                    onChange={(e) => setEditing({ ...editing, manager_id: e.target.value })}
                    placeholder="uuid"
                  />
                </div>
                <Button onClick={save} className="w-full">
                  Save
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="mt-6 space-y-3">
          {list.map((r) => (
            <div key={r.id} className="flex items-center gap-4 rounded-xl border bg-card p-4">
              <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                {r.image_url && (
                  <img src={r.image_url} alt={r.name} className="h-full w-full object-cover" />
                )}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold">{r.name}</h3>
                <p className="text-xs text-muted-foreground">{r.address}</p>
                {(r.town_name || r.pincode) && (
                  <p className="text-xs text-muted-foreground">
                    {[r.town_name, r.pincode].filter(Boolean).join(" ")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Manager: {r.manager_id ?? "unassigned"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(r);
                  setOpen(true);
                }}
              >
                Edit
              </Button>
              <Button variant="outline" size="icon" onClick={() => del(r.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </RoleGate>
  );
}
