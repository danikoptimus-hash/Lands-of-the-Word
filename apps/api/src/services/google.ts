/**
 * Вход через Google (OpenID Connect, authorization-code flow). Два сетевых вызова вынесены в отдельные функции,
 * чтобы в тестах их можно было подменить (vi.mock). Из ответа Google берём только `sub` и почту: имя и фото не запрашиваются
 * (scope `openid email`) и не хранятся.
 */
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

export interface GoogleTokens { id_token?: string; access_token?: string; error?: string; error_description?: string }
/** Поля tokeninfo, которые нам нужны (все значения — строки, как отдаёт Google). */
export interface GoogleIdClaims { sub?: string; email?: string; email_verified?: string; aud?: string; iss?: string; exp?: string; error?: string; error_description?: string }

/** Обмен кода авторизации на токены. Ошибку сети или ответа Google бросаем — маршрут переведёт её в редирект с ошибкой. */
export async function exchangeCode(code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<GoogleTokens> {
  const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" });
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = (await res.json().catch(() => ({}))) as GoogleTokens;
  if (!res.ok || !data.id_token) throw new Error(`google token exchange failed: ${res.status} ${data.error ?? ""} ${data.error_description ?? ""}`.trim());
  return data;
}

/** Проверка id_token у Google (подпись проверяет сам Google); проверки aud/iss/exp/email_verified — в маршруте. */
export async function verifyIdToken(idToken: string): Promise<GoogleIdClaims> {
  const res = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`);
  const data = (await res.json().catch(() => ({}))) as GoogleIdClaims;
  if (!res.ok) throw new Error(`google tokeninfo failed: ${res.status} ${data.error ?? ""} ${data.error_description ?? ""}`.trim());
  return data;
}
