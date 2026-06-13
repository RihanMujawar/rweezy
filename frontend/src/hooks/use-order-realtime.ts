import { useEffect, useRef } from "react";

type Options = {
  table: string;
  id: string;
  onChange: () => void;
  enabled?: boolean;
  fallbackMs?: number;
};

export function useOrderRealtime({ id, onChange, enabled = true, fallbackMs = 4000 }: Options) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled || !id) return;

    const pollId = setInterval(() => {
      onChangeRef.current();
    }, fallbackMs);

    return () => {
      if (pollId) clearInterval(pollId);
    };
  }, [enabled, fallbackMs, id]);
}
