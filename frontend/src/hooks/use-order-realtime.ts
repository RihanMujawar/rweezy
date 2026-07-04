import { useEffect, useRef } from "react";
import { socket } from "@/lib/socket";

type Options = {
  table?: string;
  id: string;
  onChange: () => void;
  enabled?: boolean;
  fallbackMs?: number;
};

export function useOrderRealtime({
  id,
  onChange,
  enabled = true,
  fallbackMs = 4000,
}: Options) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled || !id) return;

    socket.emit("join_order", id);

    const handleUpdate = () => {
      onChangeRef.current();
    };

    socket.on("order_updated", handleUpdate);

    // Fallback polling if socket not connected
    const pollId = setInterval(() => {
      if (!socket.connected) {
        onChangeRef.current();
      }
    }, fallbackMs);

    return () => {
      socket.off("order_updated", handleUpdate);
      clearInterval(pollId);
    };
  }, [enabled, fallbackMs, id]);
}
