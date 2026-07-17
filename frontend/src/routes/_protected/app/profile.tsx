import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useFoodCart } from "@/lib/food-cart";
import { useGroceryCart } from "@/lib/grocery-cart";
import { Phone, ShoppingCart, LogOut, ChevronRight, BriefcaseBusiness, CheckCircle, Clock } from "lucide-react";

export const Route = createFileRoute("/_protected/app/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user, roles } = useAuth();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [addresses, setAddresses] = useState<
    { id: string; label: string; address: string; lat?: number | null; lng?: number | null }[]
  >([]);
  const [newAddress, setNewAddress] = useState({ label: "Home", address: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [roleRequests, setRoleRequests] = useState<any[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [reqRole, setReqRole] = useState("all_in_one_partner");
  const [reqBusinessName, setReqBusinessName] = useState("");
  const [reqMessage, setReqMessage] = useState("");

  const loadRequests = async () => {
    try {
      const data = await api.roleRequests.getMine();
      setRoleRequests(data.requests || []);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    if (!user) return;
    Promise.all([api.profile.get(), api.profile.getAddresses(), api.roleRequests.getMine()]).then(
      ([{ profile }, addressData, requestsData]) => {
        setFullName(profile?.full_name ?? "");
        setPhone(profile?.phone ?? "");
        setAddresses((addressData.addresses as typeof addresses) ?? []);
        setRoleRequests((requestsData.requests as any[]) ?? []);
        setLoading(false);
      },
    );
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await api.profile.update({ full_name: fullName, phone });
      toast.success("Profile saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const addAddress = async () => {
    if (!newAddress.address.trim()) return toast.error("Address required");
    try {
      const { address } = await api.profile.addAddress({
        label: newAddress.label || "Saved address",
        address: newAddress.address,
      });
      setAddresses((current) => [address as (typeof addresses)[number], ...current]);
      setNewAddress({ label: "Home", address: "" });
      toast.success("Address saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save address");
    }
  };

  const deleteAddress = async (id: string) => {
    try {
      await api.profile.deleteAddress(id);
      setAddresses((current) => current.filter((item) => item.id !== id));
      toast.success("Address removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove address");
    }
  };

  const foodCart = useFoodCart();
  const groceryCart = useGroceryCart();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const totalCartItems = foodCart.items.length + groceryCart.items.length;

  const handleLogout = async () => {
    await signOut();
    toast.success("Logged out successfully");
    navigate({ to: "/login" });
  };

  if (loading) {
    return (
      <div className="container mx-auto max-w-2xl space-y-4 px-4 py-8">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Profile</h1>

      {/* Quick Actions Section */}
      <div className="mt-6 space-y-3">
        {/* My Orders with Phone */}
        <Link
          to="/app/orders"
          className="flex items-center justify-between rounded-2xl border bg-card p-4 transition-colors hover:bg-accent"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Phone className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="font-semibold">My Orders</div>
              {phone && <div className="text-sm text-muted-foreground">Phone: {phone}</div>}
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>

        {/* Cart Button */}
        <Link
          to={
            foodCart.items.length > 0
              ? "/app/food/checkout"
              : groceryCart.items.length > 0
                ? "/app/grocery/checkout"
                : "/app/food"
          }
          className="flex items-center justify-between rounded-2xl border bg-card p-4 transition-colors hover:bg-accent"
        >
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <ShoppingCart className="h-5 w-5 text-primary" />
              {totalCartItems > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {totalCartItems}
                </span>
              )}
            </div>
            <div>
              <div className="font-semibold">Cart</div>
              <div className="text-sm text-muted-foreground">
                {totalCartItems === 0
                  ? "No items in cart"
                  : `${totalCartItems} item${totalCartItems > 1 ? "s" : ""} in cart`}
              </div>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>

        {/* Become a Partner Section */}
        {roles.some((r) => ["rider", "delivery_boy", "all_in_one_partner", "hotel_manager", "grocery_manager"].includes(r)) ? (
          <div className="flex items-center justify-between rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <div className="font-semibold text-emerald-400">Approved Partner</div>
                <div className="text-sm text-muted-foreground">
                  Roles: {roles.filter((r) => ["rider", "delivery_boy", "all_in_one_partner", "hotel_manager", "grocery_manager"].includes(r)).map((r) => r.replace(/_/g, " ")).join(", ")}
                </div>
              </div>
            </div>
          </div>
        ) : roleRequests.filter((r) => r.status === "pending").length > 0 ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-500/10">
                <Clock className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <div className="font-semibold text-yellow-500">Partner Application Pending</div>
                <div className="text-sm text-muted-foreground">
                  Applying for: {roleRequests.filter((r) => r.status === "pending").map((r) => r.requested_role.replace(/_/g, " ")).join(", ")}
                </div>
              </div>
            </div>
            {roleRequests.filter((r) => r.status === "pending")[0].business_name && (
              <p className="text-xs text-muted-foreground">
                Details: {roleRequests.filter((r) => r.status === "pending")[0].business_name}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border bg-card p-4">
            {!showApplyForm ? (
              <button
                type="button"
                onClick={() => setShowApplyForm(true)}
                className="flex w-full items-center justify-between transition-colors focus-visible:outline-none"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <BriefcaseBusiness className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-left">
                    <div className="font-semibold">Become a Partner</div>
                    <div className="text-sm text-muted-foreground">
                      Earn with us! Apply for Ride, Delivery or All-in-One role
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-2">
                  <h3 className="font-semibold">Partner Application</h3>
                  <Button variant="ghost" size="sm" onClick={() => setShowApplyForm(false)}>
                    Cancel
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reqRole">Choose Partner Role</Label>
                  <select
                    id="reqRole"
                    value={reqRole}
                    onChange={(e) => setReqRole(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="all_in_one_partner">All-in-One Partner (Food, Grocery, Rides, Packages)</option>
                    <option value="rider">Rider (Rides & Packages)</option>
                    <option value="delivery_boy">Delivery Partner (Food & Grocery)</option>
                    <option value="hotel_manager">Restaurant Manager</option>
                    <option value="grocery_manager">Grocery Manager</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reqBusinessName">Business / Vehicle Details</Label>
                  <Input
                    id="reqBusinessName"
                    value={reqBusinessName}
                    onChange={(e) => setReqBusinessName(e.target.value)}
                    placeholder="e.g. Honda Activa UP16XX1234, or Store name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reqMessage">Message for Admins</Label>
                  <Input
                    id="reqMessage"
                    value={reqMessage}
                    onChange={(e) => setReqMessage(e.target.value)}
                    placeholder="Brief intro or experience details"
                  />
                </div>

                <Button
                  className="w-full"
                  disabled={requesting}
                  onClick={async () => {
                    if (!reqBusinessName.trim()) {
                      return toast.error("Please enter business or vehicle details");
                    }
                    setRequesting(true);
                    try {
                      await api.roleRequests.create({
                        requested_role: reqRole,
                        business_name: reqBusinessName,
                        message: reqMessage,
                      });
                      toast.success("Partner application submitted successfully!");
                      setShowApplyForm(false);
                      setReqBusinessName("");
                      setReqMessage("");
                      loadRequests();
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Failed to submit request");
                    } finally {
                      setRequesting(false);
                    }
                  }}
                >
                  {requesting ? "Submitting Application..." : "Submit Application"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mt-6 space-y-4 rounded-2xl border bg-card p-6">
        <div className="space-y-2">
          <Label>Email</Label>
          <Input value={user?.email ?? ""} disabled />
        </div>
        <div className="space-y-2">
          <Label>Full name</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      <div className="mt-6 space-y-4 rounded-2xl border bg-card p-6">
        <div>
          <h2 className="font-semibold">Saved addresses</h2>
          <p className="text-sm text-muted-foreground">
            Checkout can use these addresses so repeat orders are faster.
          </p>
        </div>
        {addresses.length === 0 ? (
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            No saved addresses yet.
          </div>
        ) : (
          <div className="space-y-2">
            {addresses.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm"
              >
                <div>
                  <div className="font-medium">{item.label}</div>
                  <div className="text-muted-foreground">{item.address}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => deleteAddress(item.id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto]">
          <Input
            value={newAddress.label}
            onChange={(e) => setNewAddress({ ...newAddress, label: e.target.value })}
            placeholder="Label"
          />
          <Input
            value={newAddress.address}
            onChange={(e) => setNewAddress({ ...newAddress, address: e.target.value })}
            placeholder="Address"
          />
          <Button className="min-h-11" onClick={addAddress}>
            Add
          </Button>
        </div>
      </div>

      {/* Logout Button - at the bottom */}
      <div className="mt-6">
        <button
          onClick={handleLogout}
          className="flex min-h-11 w-full items-center justify-between rounded-2xl border bg-card p-4 transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
              <LogOut className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <div className="font-semibold text-destructive">Logout</div>
              <div className="text-sm text-muted-foreground">Sign out of your account</div>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}
