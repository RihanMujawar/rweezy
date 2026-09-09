export function PriceBreakdown({
  lines,
  total,
  paymentMethod = "cash",
}: {
  lines: { label: string; amount: number }[];
  total: number;
  paymentMethod?: string;
}) {
  return (
    <div className="rounded-xl border bg-muted/40 p-4 text-sm">
      <div className="font-medium">Price breakdown</div>
      <div className="mt-3 space-y-1">
        {lines.map((line) => (
          <div key={line.label} className="flex justify-between">
            <span className="text-muted-foreground">{line.label}</span>
            <span>₹{line.amount.toFixed(0)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between border-t pt-2 font-semibold">
        <span>Total</span>
        <span>₹{total.toFixed(0)}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Payment:{" "}
        {paymentMethod === "cash"
          ? "Cash on delivery"
          : paymentMethod === "online"
            ? "Online payment"
            : paymentMethod === "wallet"
              ? "Wallet balance"
              : "Prepaid"}
      </p>
    </div>
  );
}
