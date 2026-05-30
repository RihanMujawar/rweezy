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
import { Phone, ShoppingCart, LogOut, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_protected/app/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [addresses, setAddresses] = useState<
    { id: string; label: string; address: string; lat?: number | null; lng?: number | null }[]
  >([]);
  const [newAddress, setNewAddress] = useState({ label: "Home", address: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([api.profile.get(), api.profile.getAddresses()]).then(
      ([{ profile }, addressData]) => {
        setFullName(profile?.full_name ?? "");
        setPhone(profile?.phone ?? "");
        setAddresses((addressData.addresses as typeof addresses) ?? []);
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
