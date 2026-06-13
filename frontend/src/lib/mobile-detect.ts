const DISMISS_KEY = "rweezy:android-app-prompt-dismissed";

export function isInAndroidApp(): boolean {
  return typeof window !== "undefined" && Boolean(window.RweezyAndroidBridge);
}

export function isAndroidPhoneBrowser(): boolean {
  if (typeof window === "undefined") return false;
  if (isInAndroidApp()) return false;

  const ua = navigator.userAgent;
  const isAndroid = /Android/i.test(ua);
  const isMobile = /Mobile/i.test(ua);
  const isEmbeddedWebView = /;\s*wv\)/i.test(ua);

  return isAndroid && isMobile && !isEmbeddedWebView;
}

export function isAndroidAppPromptDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DISMISS_KEY) === "1";
}

export function dismissAndroidAppPrompt(): void {
  window.localStorage.setItem(DISMISS_KEY, "1");
}

export function getAndroidAppDownloadUrl(): string | null {
  const url = import.meta.env.VITE_ANDROID_APP_URL as string | undefined;
  const trimmed = url?.trim();
  return trimmed ? trimmed : null;
}
