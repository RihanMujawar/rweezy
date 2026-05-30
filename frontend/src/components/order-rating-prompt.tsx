import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { api } from "@/lib/api";

export function OrderRatingPrompt({
  serviceKind,
  serviceId,
  disabled,
}: {
  serviceKind: "food" | "grocery" | "ride" | "package";
  serviceId: string;
  disabled?: boolean;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);

  if (disabled || done) return null;

  const submit = async () => {
    if (rating < 1) return toast.error("Select a star rating");
    try {
      await api.reviews.create({
        service_kind: serviceKind,
        service_id: serviceId,
        rating,
        comment,
      });
      setDone(true);
      toast.success("Thanks for your feedback!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save review");
    }
  };

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <h3 className="font-semibold">Rate this order</h3>
      <div className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            className={`h-10 w-10 rounded-full text-lg ${rating >= value ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            onClick={() => setRating(value)}
          >
            ★
          </button>
        ))}
      </div>
      <Textarea
        className="mt-3"
        placeholder="Optional comment"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <Button className="mt-3" type="button" onClick={submit}>
        Submit review
      </Button>
    </div>
  );
}
