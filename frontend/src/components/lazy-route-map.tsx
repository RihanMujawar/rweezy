import { lazy, Suspense, type ComponentProps } from "react";

export type { LatLng } from "@/lib/geo";

const RouteMapLazy = lazy(() =>
  import("@/components/route-map").then((m) => ({ default: m.RouteMap })),
);
const PickerMapLazy = lazy(() =>
  import("@/components/route-map").then((m) => ({ default: m.PickerMap })),
);
const DeliveryPinMapLazy = lazy(() =>
  import("@/components/route-map").then((m) => ({ default: m.DeliveryPinMap })),
);
const StaticPointMapLazy = lazy(() =>
  import("@/components/route-map").then((m) => ({ default: m.StaticPointMap })),
);

function MapFallback({ height = 320 }: { height?: number }) {
  return <div style={{ height }} className="animate-pulse rounded-xl border bg-muted" />;
}

export function RouteMap(props: ComponentProps<typeof import("@/components/route-map").RouteMap>) {
  return (
    <Suspense fallback={<MapFallback height={props.height} />}>
      <RouteMapLazy {...props} />
    </Suspense>
  );
}

export function PickerMap(
  props: ComponentProps<typeof import("@/components/route-map").PickerMap>,
) {
  return (
    <Suspense fallback={<MapFallback height={props.height} />}>
      <PickerMapLazy {...props} />
    </Suspense>
  );
}

export function DeliveryPinMap(
  props: ComponentProps<typeof import("@/components/route-map").DeliveryPinMap>,
) {
  return (
    <Suspense fallback={<MapFallback height={props.height ?? 280} />}>
      <DeliveryPinMapLazy {...props} />
    </Suspense>
  );
}

export function StaticPointMap(
  props: ComponentProps<typeof import("@/components/route-map").StaticPointMap>,
) {
  return (
    <Suspense fallback={<MapFallback height={props.height} />}>
      <StaticPointMapLazy {...props} />
    </Suspense>
  );
}
