import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { fieldErrors, loginEmailSchema, loginPhoneSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { refreshAuth } = useAuth();
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const hasStarted = email || phone || password;
    if (!hasStarted) return;
    const parsed =
      mode === "phone"
        ? loginPhoneSchema.safeParse({ phone: `+91${phone}`, password })
        : loginEmailSchema.safeParse({ email, password });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
  }, [email, mode, password, phone]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed =
      mode === "phone"
        ? loginPhoneSchema.safeParse({ phone: `+91${phone}`, password })
        : loginEmailSchema.safeParse({ email, password });
    if (!parsed.success) {
      const nextErrors = fieldErrors(parsed.error);
      setErrors(nextErrors);
      toast.error(Object.values(nextErrors)[0] ?? "Please check the form");
      return;
    }
    setLoading(true);
    try {
      const finalIdentifier =
        mode === "phone" ? { phone: `+91${phone}`, password } : { email, password };
      await api.auth.login(finalIdentifier);
      await refreshAuth();
    } catch (error) {
      setLoading(false);
      toast.error(error instanceof Error ? error.message : "Failed to sign in");
      return;
    }
    setLoading(false);
    toast.success("Welcome back!");
    navigate({ to: "/app" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-transparent px-4 animate-fade-in-up">
      <div className="w-full max-w-md rounded-2xl border bg-card/60 p-8 shadow-2xl backdrop-blur-xl">
        <Link 
          to="/" 
          className="text-2xl font-extrabold bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent hover:opacity-90 transition-opacity"
        >
          Rweezy
        </Link>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to continue.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-1 border border-white/5">
            <Button
              type="button"
              variant={mode === "email" ? "default" : "ghost"}
              onClick={() => setMode("email")}
              className="btn-interactive text-xs"
            >
              Email
            </Button>
            <Button
              type="button"
              variant={mode === "phone" ? "default" : "ghost"}
              onClick={() => setMode("phone")}
              className="btn-interactive text-xs"
            >
              Phone
            </Button>
          </div>
          <div className="space-y-2">
            {mode === "phone" ? (
              <>
                <Label htmlFor="phone">Phone number</Label>
                <div className="flex gap-2">
                  <div className="flex items-center justify-center rounded-md border bg-muted px-3 text-sm font-medium">
                    +91
                  </div>
                  <Input
                    id="phone"
                    name="tel"
                    type="tel"
                    pattern="[0-9]{10}"
                    placeholder="9876543210"
                    required
                    value={phone}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                      setPhone(val);
                    }}
                    className="flex-1"
                    aria-invalid={Boolean(errors.phone)}
                  />
                </div>
                {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
              </>
            ) : (
              <>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(errors.email)}
                />
                {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
              </>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don't have an account?{" "}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
