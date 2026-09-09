export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: Array<{ path: string; message: string }>) { super(message); }
}

export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data.message ?? "Ошибка запроса", data.issues);
  return data as T;
}

export interface User { id: string; nickname: string; displayName: string | null; email: string | null; locale: string; platformRole: "USER" | "SUPERADMIN" }
export interface GameSummary { id: string; name: string; status: string; teamCount: number; mapSeed: number | null; createdAt: string; org: { name: string } }
export interface MapNodeDto { key: string; q: number; r: number; kind: "EMPTY" | "CITY" | "START"; terrain: string; rotation: number; bookCode: string | null; cityType: string | null; teamIndex: number | null }
export interface MapEdgeDto { aKey: string; bKey: string }

export type TeamRole = "CAPTAIN" | "MEMBER";
export type GameRole = "NONE" | "SCOUT" | "PROPHET" | "AMBASSADOR" | "CHRONICLER";
export interface MemberDto { role: TeamRole; gameRole: GameRole; joinedAt: string; user: { id: string; nickname: string; displayName: string | null } }
export interface TeamDto { id: string; index: number; name: string; color: string; startNodeKey: string | null; members: MemberDto[] }
export interface MyTeamDto { role: TeamRole; gameRole: GameRole; team: { id: string; name: string; color: string }; game: { id: string; name: string; status: string; org: { name: string } } }

export const GAME_ROLE_LABEL: Record<GameRole, string> = { NONE: "—", SCOUT: "Разведчик", PROPHET: "Пророк", AMBASSADOR: "Посол", CHRONICLER: "Летописец" };
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { CAPTAIN: "капитан", MEMBER: "участник" };
