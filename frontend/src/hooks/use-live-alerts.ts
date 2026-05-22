import { useEffect, useRef } from "react";
import { toast } from "sonner";

type AlertItem = {
  id: string;
  status?: string;
};

function beep() {
  if (typeof window === "undefined") return;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.value = 0.04;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export function useLiveAlerts({
  items,
  label,
  enabled = true,
}: {
  items: AlertItem[];
  label: string;
  enabled?: boolean;
}) {
  const known = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  useEffect(() => {
    const current = new Set(items.map((item) => item.id));
    if (!initialized.current) {
      known.current = current;
      initialized.current = true;
      return;
    }
    const fresh = items.filter((item) => !known.current.has(item.id));
    known.current = current;
    if (!enabled || fresh.length === 0) return;
    toast.info(`${fresh.length} new ${label}${fresh.length > 1 ? "s" : ""}`);
    navigator.vibrate?.([140, 80, 140]);
    beep();
  }, [enabled, items, label]);
}
