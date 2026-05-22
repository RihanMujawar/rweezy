import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, ShieldOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { RoleGate } from "@/components/coming-soon";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/admin/restaurants")({
  component: AdminRestaurants,
});

type Restaurant = {
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  town_name: string | null;
  pincode: string | null;
  image_url: string | null;
  manager_id: string | null;
  is_open: boolean;
  created_at: string;
};

type Profile = { id: string; full_name: string | null };
type RoleRow = { user_id: string; role: string };

function AdminRestaurants() {
  const { roles } = useAuth();
  const [list, setList] = useState<Restaurant[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [managerRoles, setManagerRoles] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Restaurant>>({});
  const [orderCounts, setOrderCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const {
      restaurants: rests,
      profiles: profs,
      roles: rRoles,
      orders,
    } = await api.admin.getRestaurants();
    setList((rests as Restaurant[]) ?? []);
    const profMap: Record<string, Profile> = {};
    (profs as Profile[] | null)?.forEach((p) => (profMap[p.id] = p));
    setProfiles(profMap);
    setManagerRoles(new Set((rRoles as RoleRow[] | null)?.map((r) => r.user_id) ?? []));
    const counts: Record<string, number> = {};
    (orders as { restaurant_id: string }[] | null)?.forEach((o) => {
      counts[o.restaurant_id] = (counts[o.restaurant_id] ?? 0) + 1;
    });
    setOrderCounts(counts);
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
      if (editing.id) await api.admin.updateRestaurant(editing.id, payload);
      else await api.admin.createRestaurant(payload);
      toast.success("Saved");
      setOpen(false);
      setEditing({});
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save restaurant");
    }
  };

  const del = async (id: string) => {
    if (!confirm("Delete this restaurant and all its menu items?")) return;
    try {
      await api.admin.deleteRestaurant(id);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete restaurant");
    }
  };

  const toggleOpen = async (r: Restaurant) => {
    try {
      await api.admin.toggleRestaurant(r.id, !r.is_open);
      toast.success(`Restaurant ${!r.is_open ? "activated" : "deactivated"}`);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update restaurant");
    }
  };

  const revokeManager = async (r: Restaurant) => {
    if (!r.manager_id) return;
    if (!confirm(`Revoke hotel_manager role from this user and unassign from "${r.name}"?`)) return;
    try {
      await api.admin.revokeRestaurantManager(r.id, r.manager_id);
      toast.success("Manager access revoked");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke manager");
    }
  };

  const grantManager = async (uid: string) => {
    const restaurantId = list.find((restaurant) => restaurant.manager_id === uid)?.id;
    if (!restaurantId) return;
    try {
      await api.admin.grantRestaurantManager(restaurantId, uid);
      toast.success("Manager role granted");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to grant manager role");
    }
  };

  return (
    <RoleGate allowed={["admin"]} hasAny={roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Restaurants</h1>
            <p className="text-sm text-muted-foreground">
              Review listings, activate/deactivate, and manage hotel manager access.
            </p>
          </div>
          <Dialog
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) setEditing({});
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={() => setEditing({ is_open: true })}>
                <Plus className="mr-2 h-4 w-4" /> Add restaurant
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing.id ? "Edit" : "New"} restaurant</DialogTitle>
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
                  <Label>Manager user ID (paste from Users page)</Label>
                  <Input
                    value={editing.manager_id ?? ""}
                    onChange={(e) => setEditing({ ...editing, manager_id: e.target.value })}
                    placeholder="uuid"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={editing.is_open ?? true}
                    onCheckedChange={(v) => setEditing({ ...editing, is_open: v })}
                  />
                  <Label>Active (open for orders)</Label>
                </div>
                <Button onClick={save} className="w-full">
                  Save
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="mt-6 space-y-3">
          {list.length === 0 && (
            <div className="rounded-2xl border bg-card p-12 text-center text-muted-foreground">
              No restaurants yet.
            </div>
          )}
          {list.map((r) => {
            const manager = r.manager_id ? profiles[r.manager_id] : null;
            const managerHasRole = r.manager_id ? managerRoles.has(r.manager_id) : false;
            return (
              <div key={r.id} className="rounded-xl border bg-card p-4">
                <div className="flex items-start gap-4">
                  <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-muted">
                    {r.image_url && (
                      <img src={r.image_url} alt={r.name} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{r.name}</h3>
                      <Badge variant={r.is_open ? "default" : "secondary"}>
                        {r.is_open ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">{orderCounts[r.id] ?? 0} orders</Badge>
                    </div>
                    {r.address && <p className="mt-1 text-xs text-muted-foreground">{r.address}</p>}
                    {(r.town_name || r.pincode) && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[r.town_name, r.pincode].filter(Boolean).join(" ")}
                      </p>
                    )}
                    {r.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>
                    )}
                    <div className="mt-2 text-xs text-muted-foreground">
                      Manager:{" "}
                      {manager ? (
                        <>
                          <span className="font-medium text-foreground">
                            {manager.full_name || "(no name)"}
                          </span>
                          {!managerHasRole && (
                            <span className="ml-2 text-amber-600">⚠ no hotel_manager role</span>
                          )}
                        </>
                      ) : (
                        <span className="italic">unassigned</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Switch checked={r.is_open} onCheckedChange={() => toggleOpen(r)} />
                      <span className="text-xs">{r.is_open ? "Active" : "Inactive"}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
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
                  {r.manager_id && !managerHasRole && (
                    <Button variant="outline" size="sm" onClick={() => grantManager(r.manager_id!)}>
                      <ShieldCheck className="mr-1 h-4 w-4" /> Grant manager role
                    </Button>
                  )}
                  {r.manager_id && (
                    <Button variant="outline" size="sm" onClick={() => revokeManager(r)}>
                      <ShieldOff className="mr-1 h-4 w-4" /> Revoke manager
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => del(r.id)}>
                    <Trash2 className="mr-1 h-4 w-4" /> Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </RoleGate>
  );
}
