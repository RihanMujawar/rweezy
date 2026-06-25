import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getFirebaseApp, isFirebaseConfigured } from "@/lib/firebase";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
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
  const [email, setEmail] = useState("");
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
    const hasStarted = fullName || email || phoneSuffix || password || confirmPassword;
    if (!hasStarted) return;
    const parsed = registerSchema.safeParse({
      fullName,
      email,
      phone: fullPhone,
      password,
      confirmPassword,
      requestedRole: "customer",
    });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
  }, [confirmPassword, countryCode, email, fullName, fullPhone, password, phoneSuffix]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = registerSchema.safeParse({
      fullName,
      email,
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
        email: parsed.data.email?.toLowerCase() || "",
        phone: parsed.data.phone,
        password,
        phone_verification_token: phoneVerificationToken,
      });

      if (result.emailVerificationRequired) {
        toast.success("Account created! Check your email to verify your email address.");
        navigate({ to: "/login" });
        return;
      }

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

  const handleGoogleLogin = async () => {
    if (!isFirebaseConfigured()) {
      toast.error("Google Login is not configured");
      return;
    }

    setLoading(true);
    try {
      const auth = getAuth(getFirebaseApp());
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const idToken = await result.user.getIdToken();

      const authResult = await api.auth.loginWithFirebaseGoogle({ id_token: idToken });
      setAuthenticatedUser(authResult);
      toast.success("Welcome back!");
      navigate({ to: "/app" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Google sign in failed");
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
          Verify your phone with SMS OTP and create your account.
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
            <Label htmlFor="email">Email (optional)</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(errors.email)}
              placeholder="you@example.com"
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

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t"></span>
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full flex items-center justify-center gap-2"
          onClick={() => void handleGoogleLogin()}
          disabled={loading}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
            <path d="M1 1h22v22H1z" fill="none" />
          </svg>
          Google
        </Button>

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
