import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { MessageCircle, Phone, RotateCcw, Truck } from "lucide-react";

export const Route = createFileRoute("/_protected/app/support")({
  component: SupportPage,
});

function SupportPage() {
  const [issue, setIssue] = useState("delayed");
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = () => {
    if (!details.trim()) {
      toast.error("Describe your issue so we can help");
      return;
    }
    setSubmitted(true);
    toast.success("Support request recorded (demo). Our team will follow up.");
  };

  if (submitted) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-12 text-center">
        <h1 className="text-2xl font-bold">We received your request</h1>
        <p className="mt-2 text-muted-foreground">
          In production this would open a ticket. For now, check active orders or chat with your
          rider on the track page.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to="/app/orders">My orders</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/app">Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-lg px-4 py-8">
      <h1 className="text-2xl font-bold">Help & support</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Report delays, wrong items, cancellations, refunds, or rider contact issues.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Button asChild variant="outline" className="h-auto flex-col gap-1 py-4">
          <Link to="/app/track">
            <Truck className="h-5 w-5" />
            Track active order
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto flex-col gap-1 py-4">
          <Link to="/app/orders">
            <RotateCcw className="h-5 w-5" />
            Order history
          </Link>
        </Button>
      </div>

      <div className="mt-8 space-y-4 rounded-2xl border bg-card p-6">
        <div className="space-y-2">
          <Label>What do you need help with?</Label>
          <Select value={issue} onValueChange={setIssue}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="delayed">Order delayed</SelectItem>
              <SelectItem value="wrong">Wrong or missing items</SelectItem>
              <SelectItem value="cancel">Cancel before pickup</SelectItem>
              <SelectItem value="refund">Refund request</SelectItem>
              <SelectItem value="rider">Contact rider / delivery partner</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Details</Label>
          <Textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Order ID, what happened, and what you need..."
            rows={5}
          />
        </div>
        <Button className="w-full" onClick={submit}>
          Submit request
        </Button>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <MessageCircle className="h-3.5 w-3.5" />
          For live orders, use in-app chat on the track screen.
        </p>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Phone className="h-3.5 w-3.5" />
          Emergency demo line: +91 90000 00001
        </p>
      </div>
    </div>
  );
}
