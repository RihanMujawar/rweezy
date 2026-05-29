import { getApp, getApps, initializeApp } from "firebase/app";
import { getMessaging, getToken, isSupported, onMessage, type MessagePayload } from "firebase/messaging";
import { api } from "@/lib/api";
import { toast } from "sonner";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
let foregroundBound = false;

function isWebPushConfigured() {
  return (
    Boolean(firebaseConfig.apiKey) &&
    Boolean(firebaseConfig.projectId) &&
    Boolean(firebaseConfig.messagingSenderId) &&
    Boolean(firebaseConfig.appId) &&
    Boolean(vapidKey)
  );
}

function getFirebaseApp() {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
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
    toast(payload.notification?.title || "Rweezy", {
      description: payload.notification?.body || "You have a new update.",
    });
  });
  foregroundBound = true;
}

/** Bind FCM foreground handler app-wide (safe to call on every protected page). */
export function ensureForegroundMessageListener() {
  if (typeof window === "undefined" || !isWebPushConfigured()) return;
  bindForegroundListener();
}

export async function registerWebPushForUser() {
  if (typeof window === "undefined") return;
  if (!isWebPushConfigured()) return;
  if (!(await isSupported())) return;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

  ensureForegroundMessageListener();

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
