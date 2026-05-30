import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function EmptyState({
  title,
  description,
  actionLabel,
  actionTo,
  onRetry,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  actionTo?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-2xl border bg-card p-10 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {onRetry && (
          <Button type="button" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
        {actionLabel && actionTo && (
          <Button asChild>
            <Link to={actionTo}>{actionLabel}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
