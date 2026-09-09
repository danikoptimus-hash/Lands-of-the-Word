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
export interface MapHexDto { q: number; r: number; terrain?: string; rotation?: number; lit?: boolean }
export interface MapNodeDto { key: string; corner: "N" | "S"; q: number; r: number; kind: "EMPTY" | "CITY" | "START"; bookCode: string | null; cityType: string | null; teamIndex: number | null }
export interface MapEdgeDto { aKey: string; bKey: string }

export type TeamRole = "CAPTAIN" | "MEMBER";
export type GameRole = "NONE" | "SCOUT" | "PROPHET" | "AMBASSADOR" | "CHRONICLER";
export interface MemberDto { role: TeamRole; gameRole: GameRole; joinedAt: string; user: { id: string; nickname: string; displayName: string | null } }
export interface TeamDto { id: string; index: number; name: string; color: string; startNodeKey: string | null; members: MemberDto[] }
export interface MyTeamDto { role: TeamRole; gameRole: GameRole; team: { id: string; name: string; color: string }; game: { id: string; name: string; status: string; org: { name: string } } }

export const GAME_ROLE_LABEL: Record<GameRole, string> = { NONE: "—", SCOUT: "Разведчик", PROPHET: "Пророк", AMBASSADOR: "Посол", CHRONICLER: "Летописец" };
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { CAPTAIN: "капитан", MEMBER: "участник" };

export type EdgeTaskStatus = "OPEN" | "TAKEN" | "SUBMITTED" | "APPROVED" | "REJECTED";
export interface DeedLite { id: string; title: string; description: string; direction: string; proofType: "REPORT" | "PHOTO_LINK" | "VIDEO_LINK" | "CONFIRMATION"; difficulty: number }
export interface EdgeTaskDto { id: string; fromKey: string; toKey: string; deedId: string; status: EdgeTaskStatus; takenById: string | null; links: string[]; note: string; adminComment: string; submittedAt: string | null; deed: DeedLite }
export interface MapCityDto { nodeKey: string; hasContent: boolean; total: number; owner: { index: number; name: string; color: string } | null; orderSolved: boolean; done: number; captured: boolean; isCapital: boolean }
export interface MyMapDto { status: string; team: { id: string; name: string; color: string; startNodeKey?: string | null }; hexes: MapHexDto[]; revealed: MapNodeDto[]; edges: MapEdgeDto[]; tasks: EdgeTaskDto[]; cities: MapCityDto[] }

/** Город глазами команды: районы (сцены книги), задания без ответов, буквы шифра, состояние. */
export interface CityDistrictDto { id: string; verses: string; title: string; summary: string; index: number | null }
export type CityTaskDto =
  | { index: number; scope: string; groupDistricts: number[] | null; type: "number" | "text"; prompt: string }
  | { index: number; scope: string; groupDistricts: number[] | null; type: "choice"; prompt: string; options: string[] }
  | { index: number; scope: string; groupDistricts: number[] | null; type: "order"; prompt: string; items: Array<{ id: string; text: string }> };
export interface MyCityDto {
  node: { key: string; bookCode: string; cityType: string | null };
  owner: { id: string; index: number; name: string; color: string } | null;
  content: { title: string; translation: string; codeRule: string; districts: CityDistrictDto[]; tasks: CityTaskDto[]; fragments: Array<string | null> } | null;
  state: { orderSolved: boolean; orderAttempts: number; doneTasks: number[]; capturedAt: string | null; isCapital: boolean; cooldownUntil: number | null };
}
/** Город глазами админа: контент с ответами, ключ конверта, прогресс команд. */
export interface AdminCityTask { scope: string; type: "number" | "text" | "choice" | "order"; prompt: string; fragment: string; answer?: number; answers?: string[]; options?: string[]; correct?: number; items?: string[] }
export interface AdminCityDto {
  node: { key: string; bookCode: string; cityType: string | null; cityKey: string | null };
  content: { title: string; translation: string; codePhrase: string; codeRule: string; districts: Array<{ verses: string; title: string; summary: string }>; tasks: AdminCityTask[] } | null;
  teams: Array<{ id: string; index: number; name: string; color: string; orderSolved: boolean; orderAttempts: number; doneTasks: number[]; answerAttempts: number; capturedAt: string | null; isCapital: boolean }>;
}
export const PROOF_LABEL: Record<DeedLite["proofType"], string> = { REPORT: "отчёт текстом", PHOTO_LINK: "ссылка на фото", VIDEO_LINK: "ссылка на видео", CONFIRMATION: "подтверждение человека" };
export const TASK_STATUS_LABEL: Record<EdgeTaskStatus, string> = { OPEN: "свободно", TAKEN: "в работе", SUBMITTED: "на проверке", APPROVED: "одобрено", REJECTED: "вернули" };

/** Битва за город. Записи чужой стороны команде не видны. */
export type BattleStatus = "QUEUED" | "ATTACK" | "DEFENSE" | "WON" | "REPELLED" | "EXPIRED" | "CANCELLED";
export interface BattleEntryDto { id: string; side: "ATTACK" | "DEFENSE"; userId: string; nickname: string; ref: string; verses: number; links: string[]; note: string; status: "SUBMITTED" | "APPROVED" | "REJECTED"; adminComment: string; createdAt: string }
export interface BattleDto {
  id: string; nodeKey: string; bookCode: string; status: BattleStatus; sumMode: boolean; bid: number; defenseBid: number | null;
  attacker: { id: string; index: number; name: string; color: string }; defender: { id: string; index: number; name: string; color: string };
  passage: { ref: string; start: number; end: number; text: string[] | null } | null;
  declaredAt: string; startedAt: string | null; attackDeadline: string | null; attackDoneAt: string | null; attackApprovedAt: string | null;
  defenseDeadline: string | null; defenseDoneAt: string | null; resolvedAt: string | null;
  attackCovered: number; attackApproved: number; defenseCovered: number; defenseApproved: number; entries: BattleEntryDto[]; bookTotal: number | null;
}
export interface WarDto { defenseLevel: number; sumMode: boolean; locked: boolean; bookVerses: number | null; penalty: number; minBid: number; canDeclare: boolean; reason: string | null; owner: { id: string; name: string; color: string } | null; queue: number; battles: BattleDto[] }
export const BATTLE_STATUS_LABEL: Record<BattleStatus, string> = { QUEUED: "в очереди", ATTACK: "атака", DEFENSE: "оборона", WON: "город взят", REPELLED: "атака отражена", EXPIRED: "атака сгорела", CANCELLED: "отменена" };
