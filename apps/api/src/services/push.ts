import webpush, { WebPushError, type PushSubscription as WebPushSub } from "web-push";
import { prisma } from "../db.js";

/**
 * Web push для PWA. Ключи VAPID сервер создаёт сам при первом запуске и хранит в AppSetting,
 * так что в deploy/.env ничего добавлять не нужно. Подписки — по одной на браузер/устройство,
 * без адресов и имён. Мёртвые подписки (404/410 от push-сервиса) удаляются при отправке.
 * В тестах уведомления складываются в pushOutbox.
 */
export interface PushPayload { title: string; body: string; url: string; tag?: string }
export const pushOutbox: Array<{ userId: string; payload: PushPayload }> = [];
export const pushStats = { sent: 0, failed: 0, dropped: 0 };

let publicKey = "";
let subject = "mailto:noreply@landsoftheword.com";
let testMode = false;
let log: (e: unknown, msg: string) => void = () => {};
let loading: Promise<void> | null = null;

/** Запоминает настройки; ключи читаются из базы лениво, при первом использовании — старт сервера от базы не зависит
 *  (миграция, создающая AppSetting, может пройти уже после запуска контейнера). */
export function initPush(publicUrl: string, nodeEnv: string, logger: (e: unknown, msg: string) => void): void {
  log = logger;
  testMode = nodeEnv === "test";
  // Subject — адрес сайта: по нему push-сервисы связываются с владельцем, если что-то не так.
  if (publicUrl.startsWith("https://")) subject = publicUrl;
  publicKey = ""; loading = null;
}

async function loadKeys(): Promise<void> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: ["vapid.public", "vapid.private"] } } });
  let pub = rows.find((r) => r.key === "vapid.public")?.value, priv = rows.find((r) => r.key === "vapid.private")?.value;
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey; priv = keys.privateKey;
    await prisma.appSetting.upsert({ where: { key: "vapid.public" }, create: { key: "vapid.public", value: pub }, update: { value: pub } });
    await prisma.appSetting.upsert({ where: { key: "vapid.private" }, create: { key: "vapid.private", value: priv }, update: { value: priv } });
  }
  webpush.setVapidDetails(subject, pub, priv);
  publicKey = pub;
}

/** true, если ключи готовы. При ошибке базы — false и запись в лог; следующий вызов попробует снова. */
async function ensureKeys(): Promise<boolean> {
  if (publicKey) return true;
  loading ??= loadKeys();
  try { await loading; return true; }
  catch (e) { loading = null; log(e, "push: VAPID keys unavailable"); return false; }
}

export async function pushPublicKey(): Promise<string> { return (await ensureKeys()) ? publicKey : ""; }

/** Отправляет уведомление на все подписки перечисленных людей. Ошибки — в лог, запрос не ломают. */
export async function sendPush(userIds: string[], payloadFor: (userId: string) => PushPayload): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  if (testMode) { for (const id of ids) pushOutbox.push({ userId: id, payload: payloadFor(id) }); return; }
  if (!(await ensureKeys())) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: ids } } });
  await Promise.all(subs.map(async (s) => {
    const sub: WebPushSub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(sub, JSON.stringify(payloadFor(s.userId)), { TTL: 24 * 3600, urgency: "normal" });
      pushStats.sent++;
    } catch (e) {
      const code = e instanceof WebPushError ? e.statusCode : 0;
      if (code === 404 || code === 410) { pushStats.dropped++; await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {}); }
      else { pushStats.failed++; log(e, `push to user ${s.userId} failed`); }
    }
  }));
}
