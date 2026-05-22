import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useAuth, type AppRole } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RoleGate } from "@/components/coming-soon";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_protected/admin/users")({
  component: AdminUsers,
});

type Profile = { id: string; full_name: string | null; phone: string | null };
type RoleRow = { user_id: string; role: AppRole };
type RoleRequest = {
  id: string;
  user_id: string;
  requested_role: AppRole;
  business_name: string | null;
  message: string | null;
  created_at: string;
};

const ASSIGNABLE: AppRole[] = [
  "admin",
  "hotel_manager",
  "grocery_manager",
  "delivery_boy",
  "rider",
];

function AdminUsers() {
  const { roles } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [allRoles, setAllRoles] = useState<RoleRow[]>([]);
  const [roleRequests, setRoleRequests] = useState<RoleRequest[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { profiles, roles, roleRequests } = await api.admin.getUsers();
    setProfiles((profiles as Profile[]) ?? []);
    setAllRoles((roles as RoleRow[]) ?? []);
    setRoleRequests((roleRequests as RoleRequest[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const userRoles = (uid: string) => allRoles.filter((r) => r.user_id === uid).map((r) => r.role);

  const toggleRole = async (uid: string, role: AppRole) => {
    const has = userRoles(uid).includes(role);
    try {
      await api.admin.toggleRole(uid, role, has);
      toast.success("Updated");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update role");
    }
  };

  const reviewRequest = async (id: string, decision: "approved" | "rejected") => {
    try {
      await api.admin.reviewRoleRequest(id, decision);
      toast.success(decision === "approved" ? "Role approved" : "Request rejected");
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to review request");
    }
  };

  const filtered = profiles.filter(
    (p) =>
      !search || p.full_name?.toLowerCase().includes(search.toLowerCase()) || p.id.includes(search),
  );

  return (
    <RoleGate allowed={["admin"]} hasAny={roles.includes("admin")}>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold">Users & roles</h1>
        <Input
          className="mt-4 max-w-sm"
          placeholder="Search by name or ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {loading ? (
          <p className="mt-4 text-muted-foreground">Loading...</p>
        ) : (
          <div className="mt-6 space-y-3">
            {roleRequests.length > 0 && (
              <div className="rounded-xl border bg-card p-4">
                <h2 className="font-semibold">Pending role requests</h2>
                <div className="mt-3 space-y-2">
                  {roleRequests.map((request) => {
                    const profile = profiles.find((item) => item.id === request.user_id);
                    return (
                      <div key={request.id} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">
                              {profile?.full_name || request.user_id}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {request.requested_role.replace("_", " ")}
                            </div>
                            {request.business_name && (
                              <div className="text-xs text-muted-foreground">
                                {request.business_name}
                              </div>
                            )}
                            {request.message && (
                              <div className="text-xs text-muted-foreground">{request.message}</div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => reviewRequest(request.id, "approved")}>
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => reviewRequest(request.id, "rejected")}
                            >
                              Reject
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {filtered.map((p) => (
              <div key={p.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{p.full_name || "(no name)"}</h3>
                    <p className="text-xs text-muted-foreground">{p.id}</p>
                    {p.phone && <p className="text-xs text-muted-foreground">{p.phone}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {userRoles(p.id).map((r) => (
                      <Badge key={r} variant="secondary">
                        {r}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {ASSIGNABLE.map((role) => {
                    const active = userRoles(p.id).includes(role);
                    return (
                      <Button
                        key={role}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => toggleRole(p.id, role)}
                      >
                        {active ? "✓ " : "+ "}
                        {role.replace("_", " ")}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </RoleGate>
  );
}
