import { api } from "./api";

/**
 * Push-уведомления PWA. Подписка живёт в браузере (pushManager) и на сервере (endpoint за пользователем).
 * На iPhone push работает только у приложения, добавленного на экран «Домой» (iOS 16.4+).
 */
export type PushState = "unsupported" | "denied" | "off" | "on";

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
export const isIos = (): boolean => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = (): boolean => window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function toKey(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try { return await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 5000))]); } catch { return null; }
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  return sub ? "on" : "off";
}

/** Спрашивает разрешение (только по нажатию пользователя), подписывает устройство и сохраняет подписку на сервере. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";
  const reg = await registration();
  if (!reg) return "off";
  const { key } = await api<{ key: string }>("/api/push/key");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) as BufferSource }));
  const json = sub.toJSON();
  await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }) });
  await api("/api/push/test", { method: "POST" }).catch(() => {});
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (sub) {
    await api("/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return "off";
}

/** После входа: если устройство уже подписано, закрепить подписку за этой учёткой (endpoint мог принадлежать другому). */
export async function syncPush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  const json = sub.toJSON();
  await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }) }).catch(() => {});
}
