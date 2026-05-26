import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { fieldErrors, registerSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/register-partner")({
  component: PartnerRegisterPage,
});

const roleOptions = [
  { value: "rider", label: "Rider for rides/packages" },
  { value: "delivery_boy", label: "Food/grocery delivery partner" },
  { value: "hotel_manager", label: "Restaurant manager" },
  { value: "grocery_manager", label: "Grocery manager" },
] as const;

function PartnerRegisterPage() {
  const navigate = useNavigate();
  const { refreshAuth } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [phoneSuffix, setPhoneSuffix] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [requestedRole, setRequestedRole] =
    useState<(typeof roleOptions)[number]["value"]>("rider");
  const [businessName, setBusinessName] = useState("");
  const [roleMessage, setRoleMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const fullPhone = `${countryCode}${phoneSuffix.replace(/\D/g, "")}`;
    const parsed = registerSchema.safeParse({
      fullName,
      email,
      phone: fullPhone,
      password,
      confirmPassword,
      requestedRole,
      businessName,
      roleMessage,
    });

    if (!parsed.success) {
      const nextErrors = fieldErrors(parsed.error);
      setErrors(nextErrors);
      toast.error(Object.values(nextErrors)[0] ?? "Please check the form");
      return;
    }

    setErrors({});
    setLoading(true);
    try {
      const result = await api.auth.register({
        full_name: parsed.data.fullName,
        email: parsed.data.email.toLowerCase(),
        phone: parsed.data.phone,
        password,
        requested_role: parsed.data.requestedRole,
        business_name: parsed.data.businessName,
        role_message: parsed.data.roleMessage,
      });

      if (result.authenticated) {
        await refreshAuth();
        toast.warning(
          result.roleRequestWarning ??
            "Account created! Your role request is pending admin approval.",
        );
        navigate({ to: "/app" });
      } else {
        toast.success("Account created! You can now sign in.");
        navigate({ to: "/login" });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-transparent px-4 py-12 animate-fade-in-up">
      <div className="w-full max-w-lg rounded-2xl border bg-card/60 p-8 shadow-2xl backdrop-blur-xl">
        <Link 
          to="/" 
          className="text-2xl font-extrabold bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent hover:opacity-90 transition-opacity"
        >
          Rweezy
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Create a partner account</h1>
        <p className="text-sm text-muted-foreground">
          Use this page for rider, delivery partner, restaurant manager, or grocery manager access.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
            />
            {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone number</Label>
            <div className="flex gap-2">
              <Input
                aria-label="Country code"
                value={countryCode}
                onChange={(e) =>
                  setCountryCode(e.target.value.replace(/[^\d+]/g, "").slice(0, 5) || "+")
                }
                className="w-20"
              />
              <Input
                id="phone"
                type="tel"
                placeholder="9876543210"
                value={phoneSuffix}
                onChange={(e) => setPhoneSuffix(e.target.value.replace(/\D/g, "").slice(0, 15))}
                className="flex-1"
              />
            </div>
            {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="requestedRole">Choose role</Label>
            <select
              id="requestedRole"
              value={requestedRole}
              onChange={(e) => setRequestedRole(e.target.value as typeof requestedRole)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              These roles create a pending admin approval request.
            </p>
          </div>

          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <div className="space-y-2">
              <Label htmlFor="businessName">Business or vehicle details</Label>
              <Input
                id="businessName"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Restaurant/store name, vehicle number, or service area"
              />
              {errors.businessName && (
                <p className="text-xs text-destructive">{errors.businessName}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="roleMessage">Message for admin</Label>
              <Textarea
                id="roleMessage"
                value={roleMessage}
                onChange={(e) => setRoleMessage(e.target.value)}
                placeholder="Tell admins what access you need."
              />
              {errors.roleMessage && (
                <p className="text-xs text-destructive">{errors.roleMessage}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-destructive">{errors.confirmPassword}</p>
              )}
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating account..." : "Request access"}
          </Button>
        </form>

        <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
          <p>
            Need a normal customer account?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Use the customer signup page
            </Link>
          </p>
          <p>
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
