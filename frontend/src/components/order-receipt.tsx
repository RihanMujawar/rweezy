import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export type ReceiptData = {
  id?: string;
  title: string;
  total: number;
  lines: { label: string; amount: number }[];
  address?: string;
  deliveryPin?: string;
  estimatedAt?: string;
  paymentNote?: string;
  trackKind?: "food" | "grocery" | "ride" | "package";
};

export function OrderReceipt({ receipt }: { receipt: ReceiptData }) {
  const eta = receipt.estimatedAt ? new Date(receipt.estimatedAt) : null;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <div className="rounded-2xl border bg-card p-6">
        <h1 className="text-2xl font-bold">{receipt.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Receipt #{receipt.id?.slice(0, 8) ?? "pending"}
        </p>
        <ReceiptBody receipt={receipt} eta={eta} />
      </div>
    </div>
  );
}

function ReceiptBody({ receipt, eta }: { receipt: ReceiptData; eta: Date | null }) {
  return (
    <>
      <div className="mt-6 space-y-2 text-sm">
        {receipt.lines.map((line) => (
          <div key={line.label} className="flex justify-between">
            <span>{line.label}</span>
            <span>₹{line.amount.toFixed(0)}</span>
          </div>
        ))}
        <div className="flex justify-between border-t pt-3 font-semibold">
          <span>Total</span>
          <span>₹{receipt.total.toFixed(0)}</span>
        </div>
        {receipt.address && (
          <p className="pt-2 text-muted-foreground">Deliver to: {receipt.address}</p>
        )}
        {eta && <p className="text-muted-foreground">Estimated arrival: {eta.toLocaleString()}</p>}
        {receipt.deliveryPin && (
          <p className="rounded-lg bg-secondary px-3 py-2 font-mono text-base font-semibold">
            Delivery PIN: {receipt.deliveryPin}
          </p>
        )}
        <p className="text-muted-foreground">
          {receipt.paymentNote ?? "Payment: cash/manual demo"}
        </p>
      </div>
      <Button asChild className="mt-6 w-full">
        <Link to="/app/orders">View orders</Link>
      </Button>
      {receipt.id && receipt.trackKind && (
        <Button asChild variant="outline" className="mt-2 w-full">
          <Link to="/app/track" search={{ id: receipt.id, kind: receipt.trackKind }}>
            Track order
          </Link>
        </Button>
      )}
    </>
  );
}
