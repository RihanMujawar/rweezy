import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { fieldErrors, phoneSchema, registerSchema } from "@/lib/validation";
import { PhoneOtpVerification } from "@/components/phone-otp-verification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const { setAuthenticatedUser } = useAuth();
  const [fullName, setFullName] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [phoneSuffix, setPhoneSuffix] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phoneVerificationToken, setPhoneVerificationToken] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const fullPhone = `${countryCode}${phoneSuffix.replace(/\D/g, "")}`;

  useEffect(() => {
    setPhoneVerificationToken("");
  }, [fullPhone]);

  useEffect(() => {
    const hasStarted = fullName || phoneSuffix || password || confirmPassword;
    if (!hasStarted) return;
    const parsed = registerSchema.safeParse({
      fullName,
      phone: fullPhone,
      password,
      confirmPassword,
      requestedRole: "customer",
    });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
  }, [confirmPassword, countryCode, fullName, fullPhone, password, phoneSuffix]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = registerSchema.safeParse({
      fullName,
      phone: fullPhone,
      password,
      confirmPassword,
      requestedRole: "customer",
    });

    if (!parsed.success) {
      const nextErrors = fieldErrors(parsed.error);
      setErrors(nextErrors);
      toast.error(Object.values(nextErrors)[0] ?? "Please check the form");
      return;
    }

    if (!phoneVerificationToken) {
      toast.error("Verify your phone number with the OTP code before signing up");
      return;
    }

    setErrors({});
    setLoading(true);
    try {
      const result = await api.auth.register({
        full_name: parsed.data.fullName,
        phone: parsed.data.phone,
        password,
        phone_verification_token: phoneVerificationToken,
      });

      if (result.authenticated) {
        setAuthenticatedUser(result);
        toast.success("Account created!");
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
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Create your customer account</h1>
        <p className="text-sm text-muted-foreground">
          Verify your phone with WhatsApp OTP and create your account.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
              aria-invalid={Boolean(errors.fullName)}
            />
            {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
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
                aria-invalid={Boolean(errors.phone)}
              />
              <Input
                id="phone"
                type="tel"
                placeholder="9876543210"
                value={phoneSuffix}
                onChange={(e) => setPhoneSuffix(e.target.value.replace(/\D/g, "").slice(0, 15))}
                className="flex-1"
                aria-invalid={Boolean(errors.phone)}
              />
            </div>
            {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
          </div>

          <PhoneOtpVerification
            phone={fullPhone}
            purpose="register"
            onVerified={setPhoneVerificationToken}
            disabled={!phoneSchema.safeParse(fullPhone).success}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(errors.password)}
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
                aria-invalid={Boolean(errors.confirmPassword)}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-destructive">{errors.confirmPassword}</p>
              )}
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={loading || !phoneVerificationToken}>
            {loading ? "Creating account..." : "Sign up"}
          </Button>
        </form>

        <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
          <p>
            Need rider, delivery, restaurant, or grocery access?{" "}
            <Link to="/register-partner" className="font-medium text-primary hover:underline">
              Use the partner signup page
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
