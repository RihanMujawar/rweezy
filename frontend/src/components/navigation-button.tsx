import { Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openExternalNavigation } from "@/lib/navigation";
import type { LatLng } from "@/lib/geo";

export function NavigationButton({
  point,
  label,
  size = "sm",
}: {
  point: LatLng;
  label?: string;
  size?: "sm" | "default";
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={() => openExternalNavigation(point, label)}
    >
      <Navigation className="mr-1 h-4 w-4" />
      Navigate
    </Button>
  );
}
