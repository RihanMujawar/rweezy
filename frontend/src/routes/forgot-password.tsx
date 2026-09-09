import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { fieldErrors, passwordResetRequestSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const fullPhone = phone ? `+91${phone}` : "";

  useEffect(() => {
    if (!phone) return;
    const parsed = passwordResetRequestSchema.safeParse({ phone: fullPhone });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
  }, [fullPhone, phone]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = passwordResetRequestSchema.safeParse({ phone: fullPhone });
    if (!parsed.success) {
      const nextErrors = fieldErrors(parsed.error);
      setErrors(nextErrors);
      toast.error(Object.values(nextErrors)[0] ?? "Please check the form");
      return;
    }

    setLoading(true);
    try {
      const result = await api.auth.requestPasswordReset({
        phone: parsed.data.phone,
      });
      toast.success(result.message);
      navigate({
        to: "/reset-password",
        search: {
          phone: parsed.data.phone,
          otpSent: true,
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start password reset");
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
        <h1 className="mt-6 text-2xl font-bold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter your registered phone number. We&apos;ll send a verification code to your phone.
        </p>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-4">
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
          <Button type="submit" className="w-full" disabled={loading || phone.length !== 10}>
            {loading ? "Sending..." : "Send OTP"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Remember your password?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
