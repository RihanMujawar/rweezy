import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { fieldErrors, loginPhonePasswordSchema, loginPhoneSchema } from "@/lib/validation";
import { PhoneOtpVerification } from "@/components/phone-otp-verification";
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
  const [mode, setMode] = useState<"password" | "otp">("password");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [phoneLoginReady, setPhoneLoginReady] = useState(false);

  const fullPhone = phone ? `+91${phone}` : "";

  useEffect(() => {
    setPhoneLoginReady(false);
  }, [phone, mode]);

  useEffect(() => {
    const hasStarted = phone || password;
    if (!hasStarted) return;
    const parsed =
      mode === "otp"
        ? loginPhoneSchema.safeParse({ phone: fullPhone })
        : loginPhonePasswordSchema.safeParse({ phone: fullPhone, password });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
  }, [fullPhone, mode, password, phone]);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = loginPhonePasswordSchema.safeParse({ phone: fullPhone, password });
    if (!parsed.success) {
      const nextErrors = fieldErrors(parsed.error);
      setErrors(nextErrors);
      toast.error(Object.values(nextErrors)[0] ?? "Please check the form");
      return;
    }

    setLoading(true);
    try {
      await api.auth.login({ phone: parsed.data.phone, password: parsed.data.password });
      await refreshAuth();
      toast.success("Welcome back!");
      navigate({ to: "/app" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to sign in");
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneVerified = async () => {
    setPhoneLoginReady(true);
    await refreshAuth();
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
        <p className="text-sm text-muted-foreground">
          Sign in with your phone number using your password or a one-time SMS code.
        </p>

        <form
          onSubmit={(event) => {
            if (mode === "password") {
              void handlePasswordSubmit(event);
            } else {
              event.preventDefault();
            }
          }}
          className="mt-6 space-y-4"
        >
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-1 border border-white/5">
            <Button
              type="button"
              variant={mode === "password" ? "default" : "ghost"}
              onClick={() => setMode("password")}
              className="btn-interactive text-xs"
            >
              Password
            </Button>
            <Button
              type="button"
              variant={mode === "otp" ? "default" : "ghost"}
              onClick={() => setMode("otp")}
              className="btn-interactive text-xs"
            >
              Phone OTP
            </Button>
          </div>

          <div className="space-y-2">
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
          </div>

          {mode === "otp" ? (
            <PhoneOtpVerification
              phone={fullPhone}
              purpose="login"
              onVerified={handlePhoneVerified}
              disabled={phone.length !== 10 || phoneLoginReady}
            />
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={Boolean(errors.password)}
                />
                {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            <Link to="/forgot-password" className="font-medium text-primary hover:underline">
              Forgot password?
            </Link>
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
