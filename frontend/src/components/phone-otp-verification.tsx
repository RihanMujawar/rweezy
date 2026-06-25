import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { phoneOtpCodeSchema, phoneSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type PhoneOtpVerificationProps = {
  phone: string;
  purpose: "login" | "register" | "reset_password";
  email?: string;
  onVerified: (
    phoneVerificationToken: string,
    result?: {
      user?: { id: string; email?: string | null };
      roles?: string[];
    },
  ) => void;
  disabled?: boolean;
};

export function PhoneOtpVerification({
  phone,
  purpose,
  email,
  onVerified,
  disabled = false,
}: PhoneOtpVerificationProps) {
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    setOtpSent(false);
    setVerified(false);
    setCode("");
    setError(null);
  }, [email, phone, purpose]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const sendOtp = async () => {
    if (!phone || disabled || sending || cooldown > 0) return;
    const parsedPhone = phoneSchema.safeParse(phone);
    if (!parsedPhone.success) {
      const message = parsedPhone.error.flatten().formErrors[0] ?? "Enter a valid phone number";
      setError(message);
      toast.error(message);
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.auth.sendPhoneOtp({
        phone: parsedPhone.data,
        purpose,
        ...(purpose === "reset_password" && email ? { email } : {}),
      });
      setOtpSent(true);
      setCooldown(30);
      toast.success("Verification code sent to your phone");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send verification code";
      setError(message);
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  const verifyOtp = async () => {
    const parsed = phoneOtpCodeSchema.safeParse({ phone, code });
    if (!parsed.success) {
      const message = parsed.error.flatten().fieldErrors.code?.[0] ?? "Enter the verification code";
      setError(message);
      toast.error(message);
      return;
    }
    if (!otpSent) {
      const message = "Request a verification code first";
      setError(message);
      toast.error(message);
      return;
    }

    setVerifying(true);
    setError(null);
    try {
      const result = await api.auth.verifyPhoneOtp({
        phone: parsed.data.phone,
        code: parsed.data.code,
        purpose,
      });

      if (purpose === "register" || purpose === "reset_password") {
        if (!result.phoneVerificationToken) {
          throw new Error("Phone verification failed");
        }
        setVerified(true);
        onVerified(result.phoneVerificationToken);
        toast.success("Phone number verified");
      } else {
        onVerified("", result);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid verification code";
      setError(message);
      toast.error(message);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-white/15 bg-muted/20 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Phone verification</p>
        <p className="text-xs text-muted-foreground">
          We&apos;ll send a one-time code by SMS to confirm this number.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={sendOtp}
          disabled={
            disabled ||
            sending ||
            verified ||
            cooldown > 0 ||
            !phone ||
            (purpose === "reset_password" && !email?.trim())
          }
        >
          {sending
            ? "Sending..."
            : cooldown > 0
              ? `Resend in ${cooldown}s`
              : otpSent
                ? "Resend code"
                : "Send OTP"}
        </Button>
        {verified && (
          <span className="inline-flex items-center text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Phone verified
          </span>
        )}
      </div>

      {otpSent && !verified && (
        <div className="space-y-2">
          <Label htmlFor={`otp-${purpose}`}>Verification code</Label>
          <div className="flex gap-2">
            <Input
              id={`otp-${purpose}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
              disabled={disabled || verifying}
              aria-invalid={Boolean(error)}
            />
            <Button
              type="button"
              onClick={verifyOtp}
              disabled={disabled || verifying || code.trim().length === 0}
            >
              {verifying ? "Verifying..." : "Verify"}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
