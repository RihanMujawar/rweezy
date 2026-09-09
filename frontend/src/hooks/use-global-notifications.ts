import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { hasRole, useAuth } from "@/lib/auth-context";
import { isActiveChat } from "@/lib/active-chat";
import { useAlertsPreference } from "@/hooks/use-alerts-preference";
import { useLiveAlerts } from "@/hooks/use-live-alerts";

const DEFAULT_POLL_MS = 12000;
const RIDER_POLL_MS = 4000;

type IdItem = { id: string };
type ChatKind = "ride" | "package" | "food" | "grocery";
type ChatTarget = { kind: ChatKind; serviceId: string };

const isActiveOrderStatus = (status: string) =>
  status !== "delivered" && status !== "completed" && status !== "cancelled";

function previewChatBody(body: string) {
  return body.length > 100 ? `${body.slice(0, 97)}...` : body;
}

async function pollChatNotifications(
  userId: string,
  chats: ChatTarget[],
  snapshot: Map<string, string>,
) {
  for (const chat of chats) {
    if (isActiveChat(chat.kind, chat.serviceId)) continue;

    const key = `${chat.kind}:${chat.serviceId}`;
    try {
      const data = await api.chat.get(chat.kind, chat.serviceId);
      const messages = (data.messages as { id: string; sender_id: string; body: string }[]) ?? [];
      const latest = messages[messages.length - 1];
      if (!latest) continue;

      const previousId = snapshot.get(key);
      snapshot.set(key, latest.id);

      if (previousId && previousId !== latest.id && latest.sender_id !== userId) {
        toast.info("New chat message", {
          description: previewChatBody(latest.body),
        });
      }
    } catch {
      // Ignore chat fetch errors during background polling.
    }
  }
}

/**
 * Polls role-relevant APIs from the protected shell so alerts fire on every page,
 * not only on pages that mount their own useLiveAlerts hook.
 */
export function useGlobalNotifications() {
  const { user, roles } = useAuth();
  const { alertsEnabled: enabled } = useAlertsPreference();

  const [deliveryJobs, setDeliveryJobs] = useState<IdItem[]>([]);
  const [riderJobs, setRiderJobs] = useState<IdItem[]>([]);
  const [hotelPending, setHotelPending] = useState<IdItem[]>([]);
  const [groceryPending, setGroceryPending] = useState<IdItem[]>([]);

  const orderStatusSnapshot = useRef<Map<string, string>>(new Map());
  const adminHealthSnapshot = useRef<{
    pendingRoleRequests: number;
    foodOrdersNeedingAttention: number;
    groceryOrdersNeedingAttention: number;
    readyFoodWithoutRider: number;
  } | null>(null);
  const chatMessageSnapshot = useRef<Map<string, string>>(new Map());

  const poll = useCallback(async () => {
    if (!user || !enabled) return;

    // Check if current backend session matches frontend user ID to prevent leaking on delay/stale hooks
    try {
      const me = await api.auth.getMe();
      if (!me.user || me.user.id !== user.id) {
        // Auth session changed or expired! Clear carts and trigger reload.
        window.location.reload();
        return;
      }
    } catch {
      window.location.reload();
      return;
    }

    const tasks: Promise<void>[] = [];
    const chatTargets: ChatTarget[] = [];

    if (hasRole(roles, "delivery_boy")) {
      tasks.push(
        api.delivery
          .getAvailable()
          .then(({ food, grocery }) => {
            setDeliveryJobs([...((food as IdItem[]) ?? []), ...((grocery as IdItem[]) ?? [])]);
          })
          .catch(() => {}),
      );
      tasks.push(
        api.delivery
          .getActive()
          .then(({ food, grocery }) => {
            for (const order of (food as { id: string; status: string }[]) ?? []) {
              if (isActiveOrderStatus(order.status)) {
                chatTargets.push({ kind: "food", serviceId: order.id });
              }
            }
            for (const order of (grocery as { id: string; status: string }[]) ?? []) {
              if (isActiveOrderStatus(order.status)) {
                chatTargets.push({ kind: "grocery", serviceId: order.id });
              }
            }
          })
          .catch(() => {}),
      );
    }

    if (hasRole(roles, "rider")) {
      tasks.push(
        api.rider
          .getJobs()
          .then(({ rides, packages }) => {
            setRiderJobs([...((rides as IdItem[]) ?? []), ...((packages as IdItem[]) ?? [])]);
          })
          .catch(() => {}),
      );
      tasks.push(
        api.rider
          .getActive()
          .then(({ job, table }) => {
            const activeJob = job as { id: string; status: string } | null;
            if (!activeJob || !isActiveOrderStatus(activeJob.status)) return;
            chatTargets.push({
              kind: table === "package_deliveries" ? "package" : "ride",
              serviceId: activeJob.id,
            });
          })
          .catch(() => {}),
      );
    }

    if (hasRole(roles, "hotel_manager")) {
      tasks.push(
        api.hotel
          .getOrders()
          .then(({ orders }) => {
            const pending = ((orders as { id: string; status: string }[]) ?? []).filter(
              (order) => order.status === "pending",
            );
            setHotelPending(pending);
          })
          .catch(() => {}),
      );
    }

    if (hasRole(roles, "grocery_manager")) {
      tasks.push(
        api.groceryAdmin
          .getOrders()
          .then(({ orders }) => {
            const pending = ((orders as { id: string; status: string }[]) ?? []).filter(
              (order) => order.status === "pending",
            );
            setGroceryPending(pending);
          })
          .catch(() => {}),
      );
    }

    if (hasRole(roles, "customer")) {
      tasks.push(
        api.orders
          .getMine()
          .then((data) => {
            const nextSnapshot = new Map<string, string>();
            const entries: Array<[string, string, string]> = [
              ...(
                (data.food as { id: string; status: string; rider_id?: string | null }[]) ?? []
              ).map((order) => [`food:${order.id}`, order.status, "Food order"] as const),
              ...(
                (data.grocery as { id: string; status: string; rider_id?: string | null }[]) ?? []
              ).map((order) => [`grocery:${order.id}`, order.status, "Grocery order"] as const),
              ...(
                (data.rides as { id: string; status: string; rider_id?: string | null }[]) ?? []
              ).map((order) => [`ride:${order.id}`, order.status, "Ride"] as const),
              ...(
                (data.packages as { id: string; status: string; rider_id?: string | null }[]) ?? []
              ).map((order) => [`package:${order.id}`, order.status, "Package"] as const),
            ];

            for (const [key, status, label] of entries) {
              nextSnapshot.set(key, status);
              const previous = orderStatusSnapshot.current.get(key);
              if (previous && previous !== status) {
                toast.info(`${label} is now ${status.replace(/_/g, " ")}`);
              }
            }
            orderStatusSnapshot.current = nextSnapshot;

            for (const order of (data.food as {
              id: string;
              status: string;
              rider_id?: string | null;
            }[]) ?? []) {
              if (isActiveOrderStatus(order.status) && order.rider_id) {
                chatTargets.push({ kind: "food", serviceId: order.id });
              }
            }
            for (const order of (data.grocery as {
              id: string;
              status: string;
              rider_id?: string | null;
            }[]) ?? []) {
              if (isActiveOrderStatus(order.status) && order.rider_id) {
                chatTargets.push({ kind: "grocery", serviceId: order.id });
              }
            }
            for (const order of (data.rides as {
              id: string;
              status: string;
              rider_id?: string | null;
            }[]) ?? []) {
              if (isActiveOrderStatus(order.status) && order.rider_id) {
                chatTargets.push({ kind: "ride", serviceId: order.id });
              }
            }
            for (const order of (data.packages as {
              id: string;
              status: string;
              rider_id?: string | null;
            }[]) ?? []) {
              if (isActiveOrderStatus(order.status) && order.rider_id) {
                chatTargets.push({ kind: "package", serviceId: order.id });
              }
            }
          })
          .catch(() => {}),
      );
    }

    if (hasRole(roles, "admin")) {
      tasks.push(
        api.admin
          .getHealth()
          .then((health) => {
            const previous = adminHealthSnapshot.current;
            if (previous) {
              const messages: string[] = [];
              if (health.pendingRoleRequests > previous.pendingRoleRequests) {
                messages.push("new role requests");
              }
              if (health.foodOrdersNeedingAttention > previous.foodOrdersNeedingAttention) {
                messages.push("food orders need attention");
              }
              if (health.groceryOrdersNeedingAttention > previous.groceryOrdersNeedingAttention) {
                messages.push("grocery orders need attention");
              }
              if (health.readyFoodWithoutRider > previous.readyFoodWithoutRider) {
                messages.push("ready food waiting for rider");
              }
              if (messages.length > 0) {
                toast.info(`Admin: ${messages.join(", ")}`);
              }
            }
            adminHealthSnapshot.current = health;
          })
          .catch(() => {}),
      );
    }

    await Promise.all(tasks);

    if (chatTargets.length > 0) {
      await pollChatNotifications(user.id, chatTargets, chatMessageSnapshot.current);
    }
  }, [enabled, roles, user]);

  useEffect(() => {
    if (!user || !enabled) return;
    poll();
    const intervalMs = hasRole(roles, "rider") ? RIDER_POLL_MS : DEFAULT_POLL_MS;
    const timer = window.setInterval(poll, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, poll, roles, user]);

  useLiveAlerts({
    items: deliveryJobs,
    label: "delivery job",
    enabled: enabled && hasRole(roles, "delivery_boy"),
  });
  useLiveAlerts({
    items: riderJobs,
    label: "ride or package job",
    enabled: enabled && hasRole(roles, "rider"),
  });
  useLiveAlerts({
    items: hotelPending,
    label: "restaurant order",
    enabled: enabled && hasRole(roles, "hotel_manager"),
  });
  useLiveAlerts({
    items: groceryPending,
    label: "grocery order",
    enabled: enabled && hasRole(roles, "grocery_manager"),
  });
}
