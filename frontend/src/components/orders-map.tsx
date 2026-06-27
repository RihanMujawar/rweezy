import { useMemo, useState } from "react";
import { StaticPointMap, type LatLng } from "./route-map";
import { Button } from "./ui/button";
import { Phone, MessageSquare, CheckCircle2, X } from "lucide-react";
import { Badge } from "./ui/badge";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogTitle, DialogHeader } from "./ui/dialog";
import { ChatPanel } from "./chat-panel";

export type MapOrder = {
  id: string;
  lat: number;
  lng: number;
  pickupLat?: number;
  pickupLng?: number;
  customerName?: string;
  customerPhone?: string;
  status: string;
  total?: number;
  items?: { name: string; quantity: number }[];
  type: "food" | "grocery" | "ride" | "package";
  canAccept?: boolean;
};

export function OrdersMap({
  orders,
  onAccept,
  height = 500,
}: {
  orders: MapOrder[];
  onAccept?: (id: string, type: MapOrder["type"]) => void;
  height?: number;
}) {
  const [selectedOrder, setSelectedOrder] = useState<MapOrder | null>(null);
  const [showChat, setShowChat] = useState(false);

  const markers = useMemo(() => {
    const m = [];
    for (const o of orders) {
      m.push({
        id: o.id,
        point: { lat: o.lat, lng: o.lng },
        kind: (o.type === "ride" || o.type === "package" ? "rider" : "drop") as any,
      });
      if (o.pickupLat && o.pickupLng) {
        m.push({
          id: `${o.id}-pickup`,
          point: { lat: o.pickupLat, lng: o.pickupLng },
          kind: "pickup" as const,
        });
      }
    }
    return m;
  }, [orders]);

  const center = useMemo(() => {
    if (orders.length === 0) return { lat: 12.9716, lng: 77.5946 };
    const lat = orders.reduce((sum, o) => sum + o.lat, 0) / orders.length;
    const lng = orders.reduce((sum, o) => sum + o.lng, 0) / orders.length;
    return { lat, lng };
  }, [orders]);

  const handleMarkerClick = (id: string) => {
    const realId = id.replace("-pickup", "");
    const order = orders.find((o) => o.id === realId);
    if (order) {
      setSelectedOrder(order);
      setShowChat(false);
    }
  };

  return (
    <div className="relative w-full overflow-hidden rounded-xl border bg-card" style={{ height }}>
      <StaticPointMap
        point={center}
        height={height}
        markers={markers}
        onMarkerClick={handleMarkerClick}
      />

      {selectedOrder && (
        <div className="absolute bottom-4 left-4 right-4 z-10 rounded-xl border bg-background p-4 shadow-xl animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-bold">{selectedOrder.customerName || "Customer"}</h3>
              <p className="text-sm text-muted-foreground">{selectedOrder.customerPhone || "No phone"}</p>
            </div>
            <Badge variant="secondary" className="capitalize">{selectedOrder.status}</Badge>
          </div>

          <div className="mt-2 text-sm">
             {selectedOrder.items && (
               <ul className="space-y-1">
                 {selectedOrder.items.map((item, i) => (
                   <li key={i}>{item.quantity}x {item.name}</li>
                 ))}
               </ul>
             )}
             {selectedOrder.total && <p className="mt-1 font-semibold">Total: ₹{selectedOrder.total}</p>}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {selectedOrder.canAccept && onAccept && (
              <Button size="sm" onClick={() => { onAccept(selectedOrder.id, selectedOrder.type); setSelectedOrder(null); }}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Accept
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
               <a href={`tel:${selectedOrder.customerPhone}`}>
                 <Phone className="mr-2 h-4 w-4" /> Call
               </a>
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowChat(true)}>
              <MessageSquare className="mr-2 h-4 w-4" /> Chat
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedOrder(null)}>Close</Button>
          </div>
        </div>
      )}

      <Dialog open={showChat && !!selectedOrder} onOpenChange={setShowChat}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Chat with {selectedOrder?.customerName || "Customer"}</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <ChatPanel
              kind={
                selectedOrder.type === "ride" || selectedOrder.type === "package"
                  ? (selectedOrder.type === "ride" ? "ride" : "package")
                  : (selectedOrder.type === "food" ? "food" : "grocery")
              }
              serviceId={selectedOrder.id}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
