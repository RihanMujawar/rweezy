export function generateDeliveryPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function estimateDeliveryMinutes(prepMinutes, km) {
  const travelMinutes = km > 0 ? Math.ceil((km / 22) * 60) : 15;
  return Math.max(15, prepMinutes + travelMinutes);
}

export function estimateDeliveryAt(prepMinutes, from, to, distanceKmFn) {
  const km = distanceKmFn(from, to);
  const minutes = estimateDeliveryMinutes(prepMinutes, km);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function sanitizeComment(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, 500);
  return text || null;
}

export function assertDeliveryPin(order, provided) {
  const expected = order?.delivery_pin;
  if (!expected) return;
  const pin = typeof provided === "string" ? provided.trim() : "";
  if (pin !== expected) {
    throw new Error("INVALID_PIN");
  }
}

export const STATUS_TRANSITIONS = {
  delivery: {
    preparing: ["picked_up"],
    ready: ["picked_up"],
    picked_up: ["delivered"],
  },
  ride: {
    accepted: ["started"],
    started: ["completed"],
  },
  package: {
    accepted: ["started"],
    started: ["completed"],
    picked_up: ["completed"],
  },
};

export function canAdvanceStatus(flow, currentStatus, nextStatus) {
  const steps = STATUS_TRANSITIONS[flow];
  if (!steps || typeof currentStatus !== "string" || typeof nextStatus !== "string") {
    return false;
  }

  return steps[currentStatus]?.includes(nextStatus) ?? false;
}

export function assertStatusAdvance(flow, currentStatus, nextStatus) {
  if (!canAdvanceStatus(flow, currentStatus, nextStatus)) {
    throw new Error("INVALID_STATUS_TRANSITION");
  }
}
