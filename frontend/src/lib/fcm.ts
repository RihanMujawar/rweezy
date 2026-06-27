import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type MessagePayload,
} from "firebase/messaging";
import { api } from "@/lib/api";
import { isActiveChat } from "@/lib/active-chat";
import { firebaseConfig, getFirebaseApp } from "@/lib/firebase";
import { toast } from "sonner";

declare global {
  interface Window {
    RweezyAndroidBridge?: {
      getFcmToken?: () => string;
      refreshFcmToken?: () => void;
    };
  }
}

const ANDROID_TOKEN_CACHE_KEY = "rweezy:android-fcm-token";

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
let foregroundBound = false;
let foregroundBinding: Promise<void> | null = null;

function isWebPushConfigured() {
  return (
    Boolean(firebaseConfig.apiKey) &&
    Boolean(firebaseConfig.projectId) &&
    Boolean(firebaseConfig.messagingSenderId) &&
    Boolean(firebaseConfig.appId) &&
    Boolean(vapidKey)
  );
}

function buildServiceWorkerUrl() {
  const params = new URLSearchParams({
    apiKey: firebaseConfig.apiKey ?? "",
    authDomain: firebaseConfig.authDomain ?? "",
    projectId: firebaseConfig.projectId ?? "",
    storageBucket: firebaseConfig.storageBucket ?? "",
    messagingSenderId: firebaseConfig.messagingSenderId ?? "",
    appId: firebaseConfig.appId ?? "",
  });
  return `/firebase-messaging-sw.js?${params.toString()}`;
}

function bindForegroundListener() {
  if (foregroundBound) return;
  const messaging = getMessaging(getFirebaseApp());
  onMessage(messaging, (payload: MessagePayload) => {
    const data = payload.data ?? {};
    if (
      data.type === "chat" &&
      data.service_kind &&
      data.service_id &&
      isActiveChat(data.service_kind, data.service_id)
    ) {
      return;
    }

    const title = payload.notification?.title || data.title || "Rweezy";
    const description = payload.notification?.body || data.body || "You have a new update.";
    toast(title, { description });
  });
  foregroundBound = true;
}

/** Bind FCM foreground handler app-wide (safe to call on every protected page). */
export function ensureForegroundMessageListener(): Promise<void> {
  if (typeof window === "undefined" || window.RweezyAndroidBridge || !isWebPushConfigured()) {
    return Promise.resolve();
  }
  if (foregroundBound) return Promise.resolve();
  if (foregroundBinding) return foregroundBinding;

  foregroundBinding = isSupported()
    .then((supported) => {
      if (supported) bindForegroundListener();
    })
    .catch(() => {
      // Foreground notifications are optional. A browser or webview without
      // the required Push APIs must never prevent the application from loading.
    })
    .finally(() => {
      foregroundBinding = null;
    });

  return foregroundBinding;
}

function waitForAndroidFcmToken(): Promise<string> {
  const bridge = window.RweezyAndroidBridge;
  if (!bridge?.getFcmToken) return Promise.resolve("");

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("rweezy:fcm-token-updated", onUpdated);
      window.clearTimeout(timeoutId);
      resolve(bridge.getFcmToken?.() ?? "");
    };

    const onUpdated = () => finish();
    const timeoutId = window.setTimeout(finish, 5000);
    window.addEventListener("rweezy:fcm-token-updated", onUpdated);
    bridge.refreshFcmToken?.();
  });
}

async function registerAndroidNativePush() {
  const bridge = window.RweezyAndroidBridge;
  if (!bridge?.getFcmToken) return;

  let token = bridge.getFcmToken();
  if (!token) {
    token = await waitForAndroidFcmToken();
  }
  if (!token) return;

  const previous = window.localStorage.getItem(ANDROID_TOKEN_CACHE_KEY);
  if (previous === token) return;

  await api.notifications.saveToken({
    token,
    platform: "android",
    user_agent: navigator.userAgent,
  });
  window.localStorage.setItem(ANDROID_TOKEN_CACHE_KEY, token);
}

function bindAndroidTokenRefresh() {
  if (
    !window.RweezyAndroidBridge ||
    (window as Window & { __rweezyAndroidTokenBound?: boolean }).__rweezyAndroidTokenBound
  ) {
    return;
  }

  (window as Window & { __rweezyAndroidTokenBound?: boolean }).__rweezyAndroidTokenBound = true;
  window.addEventListener("rweezy:fcm-token-updated", () => {
    window.localStorage.removeItem(ANDROID_TOKEN_CACHE_KEY);
    registerAndroidNativePush().catch(() => {});
  });
}

export async function registerWebPushForUser() {
  if (typeof window === "undefined") return;

  if (window.RweezyAndroidBridge) {
    bindAndroidTokenRefresh();
    await registerAndroidNativePush();
    return;
  }

  if (!isWebPushConfigured()) return;
  if (!(await isSupported())) return;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

  await ensureForegroundMessageListener();

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;

  const registration = await navigator.serviceWorker.register(buildServiceWorkerUrl());
  const messaging = getMessaging(getFirebaseApp());
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });

  if (!token) return;

  const cacheKey = "rweezy:fcm-token";
  const previous = window.localStorage.getItem(cacheKey);
  if (previous === token) return;

  await api.notifications.saveToken({
    token,
    platform: "web",
    user_agent: navigator.userAgent,
  });
  window.localStorage.setItem(cacheKey, token);
}
