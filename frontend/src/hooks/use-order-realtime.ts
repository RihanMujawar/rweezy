import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

type Options = {
  table: string;
  id: string;
  onChange: () => void;
  enabled?: boolean;
  fallbackMs?: number;
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

  useEffect(() => {
    if (!enabled || !id) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;
    let realtimeActive = false;

    try {
      channel = supabase
        .channel(`order-${table}-${id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `id=eq.${id}` },
          () => onChangeRef.current(),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") realtimeActive = true;
        });
    } catch {
      realtimeActive = false;
    }

    pollId = setInterval(() => {
      if (!realtimeActive) onChangeRef.current();
    }, fallbackMs);

    return () => {
      if (pollId) clearInterval(pollId);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, fallbackMs, id, table]);
}
