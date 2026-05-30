import { useState } from "react";
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

export function DeliveryPinDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: (pin: string) => Promise<void> | void;
}) {
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!/^\d{4}$/.test(pin)) return;
    setSubmitting(true);
    try {
      await onConfirm(pin);
      setPin("");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <PinField pin={pin} setPin={setPin} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={pin.length !== 4 || submitting} onClick={submit}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PinField({ pin, setPin }: { pin: string; setPin: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="delivery-pin">4-digit PIN</Label>
      <Input
        id="delivery-pin"
        inputMode="numeric"
        maxLength={4}
        placeholder="1234"
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
      />
    </div>
  );
}
