import { cn } from "@/lib/utils";

export function LoadingSkeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function PageLoadingSkeleton() {
  return (
    <div className="container mx-auto space-y-4 px-4 py-8">
      <LoadingSkeleton className="h-8 w-48" />
      <LoadingSkeleton className="h-32 w-full" />
      <LoadingSkeleton className="h-32 w-full" />
      <LoadingSkeleton className="h-32 w-full" />
    </div>
  );
}
