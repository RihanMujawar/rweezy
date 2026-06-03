import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { fieldErrors, passwordResetCompleteSchema } from "@/lib/validation";
import { PhoneOtpVerification } from "@/components/phone-otp-verification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const resetSearchSchema = z.object({
  email: z.string().email().optional(),
  phoneHint: z.string().optional(),
});

export const Route = createFileRoute("/reset-password")({
  validateSearch: resetSearchSchema,
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { refreshAuth } = useAuth();
  const search = Route.useSearch();
  const [email, setEmail] = useState(search.email ?? "");
  const [phoneSuffix, setPhoneSuffix] = useState("");
  const [emailOtp, setEmailOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phoneVerificationToken, setPhoneVerificationToken] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const fullPhone = phoneSuffix ? `+91${phoneSuffix.replace(/\D/g, "").slice(0, 10)}` : "";
  const phoneHint = search.phoneHint;

  useEffect(() => {
    setPhoneVerificationToken("");
  }, [fullPhone, email]);

  const validationPayload = useMemo(
    () => ({
      email,
      phone: fullPhone,
      password,
      confirmPassword,
      emailOtp,
    }),
    [confirmPassword, email, emailOtp, fullPhone, password],
  );

  useEffect(() => {
    const hasStarted = Object.values(validationPayload).some((value) => Boolean(value));
    if (!hasStarted) return;
    const parsed = passwordResetCompleteSchema.safeParse(validationPayload);
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
  }, [validationPayload]);

  const resendResetEmail = async () => {
    if (!email.trim()) {
      toast.error("Enter your email first");
      return;
    }
    setResending(true);
    try {
      const result = await api.auth.requestPasswordReset({ email: email.trim().toLowerCase() });
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to resend email code");
    } finally {
      setResending(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = passwordResetCompleteSchema.safeParse(validationPayload);
    if (!parsed.success) {
      const nextErrors = fieldErrors(parsed.error);
      setErrors(nextErrors);
      toast.error(Object.values(nextErrors)[0] ?? "Please check the form");
      return;
    }

    if (!phoneVerificationToken) {
      toast.error("Verify your phone number with the OTP code before setting a new password");
      return;
    }

    setLoading(true);
    try {
      const result = await api.auth.completePasswordReset({
        email: parsed.data.email.toLowerCase(),
        phone: parsed.data.phone,
        phone_verification_token: phoneVerificationToken,
        email_otp: parsed.data.emailOtp,
        password: parsed.data.password,
      });
      await refreshAuth();
      toast.success(result.message);
      navigate({ to: "/app" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset password");
    } finally {
      setLoading(false);
    }
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
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">
          Enter the code from your email, then verify the phone number on your account.
          {phoneHint ? ` Registered number ends with ${phoneHint}.` : null}
        </p>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reset-email">Email</Label>
            <Input
              id="reset-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email-otp">Email OTP</Label>
            <Input
              id="email-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={emailOtp}
              onChange={(event) => setEmailOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-invalid={Boolean(errors.emailOtp)}
            />
            {errors.emailOtp && <p className="text-xs text-destructive">{errors.emailOtp}</p>}
          </div>

          <Button
            type="button"
            variant="ghost"
            className="w-full text-xs"
            disabled={resending || !email.trim()}
            onClick={resendResetEmail}
          >
            {resending ? "Sending..." : "Resend email code"}
          </Button>

          <div className="space-y-2">
            <Label htmlFor="reset-phone">Phone number</Label>
            <div className="flex gap-2">
              <div className="flex items-center justify-center rounded-md border bg-muted px-3 text-sm font-medium">
                +91
              </div>
              <Input
                id="reset-phone"
                name="tel"
                type="tel"
                pattern="[0-9]{10}"
                placeholder="9876543210"
                required
                value={phoneSuffix}
                onChange={(event) => {
                  const val = event.target.value.replace(/\D/g, "").slice(0, 10);
                  setPhoneSuffix(val);
                }}
                className="flex-1"
                aria-invalid={Boolean(errors.phone)}
              />
            </div>
            {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
          </div>

          <PhoneOtpVerification
            phone={fullPhone}
            purpose="reset_password"
            email={email.trim().toLowerCase()}
            onVerified={setPhoneVerificationToken}
            disabled={phoneSuffix.length !== 10 || !email.trim()}
          />

          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(errors.password)}
            />
            {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              aria-invalid={Boolean(errors.confirmPassword)}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-destructive">{errors.confirmPassword}</p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={loading || emailOtp.length !== 6 || !phoneVerificationToken}
          >
            {loading ? "Updating..." : "Update password"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="/login" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
