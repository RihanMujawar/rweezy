import { useEffect } from "react";
import { ensureForegroundMessageListener } from "@/lib/fcm";
import { useGlobalNotifications } from "@/hooks/use-global-notifications";

/** Mounted once in the protected layout — alerts work on every page. */
export function GlobalNotificationWatcher() {
  useGlobalNotifications();

  useEffect(() => {
    void ensureForegroundMessageListener();
  }, []);

  return null;
}
