import { useEffect, useRef, useState } from "react";
import { useWebSocket } from "@/lib/websocket-context";

type Options = {
  table: string;
  id: string;
  onChange: () => void;
  enabled?: boolean;
  fallbackMs?: number;
};

const tableToKind: Record<string, string> = {
  rides: "ride",
  package_deliveries: "package",
  food_orders: "food",
  grocery_orders: "grocery",
};

export function useOrderRealtime({
  table,
  id,
  onChange,
  enabled = true,
  fallbackMs = 4000,
}: Options) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const { subscribe, isConnected } = useWebSocket();

  useEffect(() => {
    if (!enabled || !id) return;

    const kind = tableToKind[table];
    if (!kind) return;

    const topic = `track:${kind}:${id}`;
    let wsActive = false;
    let unsubscribeWs: (() => void) | null = null;

    try {
      unsubscribeWs = subscribe(topic, (data) => {
        onChangeRef.current();
      });
      wsActive = isConnected;
    } catch (err) {
      console.warn("[WebSocket] Tracking subscription failed, falling back to polling", err);
      wsActive = false;
    }

    // Resilience fallback: always run polling fallback if WebSocket is not active
    const pollId = setInterval(() => {
      if (!wsActive || !isConnected) {
        onChangeRef.current();
      }
    }, fallbackMs);

    return () => {
      clearInterval(pollId);
      if (unsubscribeWs) unsubscribeWs();
    };
  }, [enabled, fallbackMs, id, table, subscribe, isConnected]);
}
