import { Label } from "@/components/ui/label";

export type PaymentMethod = "cash" | "online" | "wallet" | "demo";

const OPTIONS: { value: PaymentMethod; label: string; hint: string }[] = [
  { value: "cash", label: "Cash", hint: "Pay on delivery or at pickup" },
  { value: "online", label: "Online", hint: "UPI/card (demo — not charged)" },
  { value: "wallet", label: "Wallet", hint: "Rweezy wallet (demo balance)" },
  { value: "demo", label: "Demo mode", hint: "Skip real payment for testing" },
];

export function PaymentMethodPicker({
  value,
  onChange,
}: {
  value: PaymentMethod;
  onChange: (value: PaymentMethod) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Payment method</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-xl border p-3 text-left transition ${
              value === option.value
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "hover:border-primary/40"
            }`}
          >
            <div className="font-medium">{option.label}</div>
            <div className="text-xs text-muted-foreground">{option.hint}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
