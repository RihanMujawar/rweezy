import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { phoneSchema } from "@/lib/validation";

const STORAGE_KEY = "zoomly_onboarding_done";

type Props = {
  userId: string;
  email?: string | null;
};

export function OnboardingDialog({ userId, email }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [preferred, setPreferred] = useState("food");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const done = localStorage.getItem(`${STORAGE_KEY}:${userId}`);
    if (done) return;

    Promise.all([api.profile.get(), api.profile.getAddresses()])
      .then(([{ profile }, { addresses }]) => {
        const needsName = !profile?.full_name;
        const needsPhone = !profile?.phone;
        const needsAddress = !(addresses as unknown[])?.length;
        if (needsName || needsPhone || needsAddress) {
          setFullName(profile?.full_name ?? "");
          setPhone(profile?.phone ?? "");
          setOpen(true);
        } else {
          localStorage.setItem(`${STORAGE_KEY}:${userId}`, "1");
        }
      })
      .catch(() => {});
  }, [userId]);

  const finish = () => {
    localStorage.setItem(`${STORAGE_KEY}:${userId}`, "1");
    setOpen(false);
  };

  const saveProfile = async () => {
    if (!fullName.trim()) {
      toast.error("Enter your name");
      return;
    }
    const parsedPhone = phoneSchema.safeParse(phone);
    if (!parsedPhone.success) {
      toast.error(parsedPhone.error.issues[0]?.message ?? "Enter a valid phone");
      return;
    }
    setSaving(true);
    try {
      await api.profile.update({ full_name: fullName.trim(), phone: parsedPhone.data });
      setStep(1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  const saveAddress = async () => {
    if (!address.trim()) {
      setStep(2);
      return;
    }
    setSaving(true);
    try {
      await api.profile.addAddress({ label: "Home", address: address.trim() });
      setStep(2);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save address");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && finish()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome to Zoomly</DialogTitle>
          <DialogDescription>
            {step === 0 && "Set up your profile so orders and support reach you."}
            {step === 1 && "Add a default delivery address for faster checkout."}
            {step === 2 && "Pick what you use most — you can change this anytime."}
          </DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+919876543210"
              />
            </div>
            {email && <p className="text-xs text-muted-foreground">Signed in as {email}</p>}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-2">
            <Label>Default address (optional)</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, area, city..."
            />
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: "food", label: "Food" },
              { id: "grocery", label: "Grocery" },
              { id: "ride", label: "Ride" },
              { id: "package", label: "Package" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreferred(item.id)}
                className={`rounded-lg border p-3 text-sm font-medium ${
                  preferred === item.id ? "border-primary bg-primary/5" : ""
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        <DialogFooter>
          {step === 0 && (
            <Button onClick={saveProfile} disabled={saving}>
              {saving ? "Saving..." : "Continue"}
            </Button>
          )}
          {step === 1 && (
            <>
              <Button variant="ghost" onClick={() => setStep(2)}>
                Skip
              </Button>
              <Button onClick={saveAddress} disabled={saving}>
                {saving ? "Saving..." : "Continue"}
              </Button>
            </>
          )}
          {step === 2 && (
            <Button
              onClick={() => {
                localStorage.setItem(`zoomly_preferred_service:${userId}`, preferred);
                finish();
                toast.success("You're all set!");
              }}
            >
              Start using Zoomly
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
