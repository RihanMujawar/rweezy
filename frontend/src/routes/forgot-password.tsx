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
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email) return;
    const parsed = passwordResetRequestSchema.safeParse({ email });
    setErrors(parsed.success ? {} : fieldErrors(parsed.error));
  }, [email]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = passwordResetRequestSchema.safeParse({ email });
    if (!parsed.success) {
      const nextErrors = fieldErrors(parsed.error);
      setErrors(nextErrors);
      toast.error(Object.values(nextErrors)[0] ?? "Please check the form");
      return;
    }

    setLoading(true);
    try {
      const result = await api.auth.requestPasswordReset({
        email: parsed.data.email.toLowerCase(),
      });
      toast.success(result.message);
      navigate({
        to: "/reset-password",
        search: {
          email: parsed.data.email.toLowerCase(),
          phoneHint: result.phoneHint ?? undefined,
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
          Enter the email on your account. We&apos;ll send a reset code and you&apos;ll confirm your
          phone number on the next step.
        </p>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending..." : "Send email code"}
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
