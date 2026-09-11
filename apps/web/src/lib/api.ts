import { t } from "./i18n";
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

export const GAME_ROLE_LABEL: Record<GameRole, string> = { get NONE() { return "—"; }, get SCOUT() { return t("Разведчик"); }, get PROPHET() { return t("Пророк"); }, get AMBASSADOR() { return t("Посол"); }, get CHRONICLER() { return t("Летописец"); } };
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { get CAPTAIN() { return t("капитан"); }, get MEMBER() { return t("участник"); } };

export type EdgeTaskStatus = "OPEN" | "TAKEN" | "SUBMITTED" | "APPROVED" | "REJECTED";
export interface DeedLite { id: string; title: string; description: string; direction: string; proofType: "REPORT" | "PHOTO_LINK" | "VIDEO_LINK" | "CONFIRMATION"; difficulty: number }
export interface EdgeTaskDto { id: string; fromKey: string; toKey: string; deedId: string; status: EdgeTaskStatus; takenById: string | null; links: string[]; note: string; adminComment: string; submittedAt: string | null; deed: DeedLite; donation?: boolean; donationAmount?: number | null }
export interface MapCityDto { nodeKey: string; hasContent: boolean; total: number; owner: { index: number; name: string; color: string } | null; orderSolved: boolean; done: number; captured: boolean; isCapital: boolean; battle: "ATTACK" | "DEFENSE" | null; ruined: boolean; blocked: boolean; passage: string | null }
export interface MyMapDto { status: string; team: { id: string; name: string; color: string; startNodeKey?: string | null }; hexes: MapHexDto[]; revealed: MapNodeDto[]; edges: MapEdgeDto[]; tasks: EdgeTaskDto[]; cities: MapCityDto[]; peeked: Array<{ key: string; kind: string }> }

/** Город глазами команды: районы (сцены книги), задания без ответов, буквы шифра, состояние. */
export interface CityDistrictDto { id: string; verses: string; title: string; summary: string; index: number | null }
export type CityTaskDto =
  | { index: number; scope: string; groupDistricts: number[] | null; type: "number" | "text"; prompt: string }
  | { index: number; scope: string; groupDistricts: number[] | null; type: "choice"; prompt: string; options: string[] }
  | { index: number; scope: string; groupDistricts: number[] | null; type: "order"; prompt: string; items: Array<{ id: string; text: string }> };
export interface MyCityDto {
  node: { key: string; bookCode: string; cityType: string | null; ruined: boolean };
  owner: { id: string; index: number; name: string; color: string } | null;
  team: { capitalMovedAt: string | null; gameRole: GameRole; role: TeamRole };
  content: { title: string; translation: string; codeRule: string; districts: CityDistrictDto[]; tasks: CityTaskDto[]; fragments: Array<string | null> } | null;
  state: { orderSolved: boolean; orderAttempts: number; doneTasks: number[]; capturedAt: string | null; isCapital: boolean; secondCapital: boolean; hintTasks: number[]; cooldownUntil: number | null };
}
/** Город глазами админа: контент с ответами, ключ конверта, прогресс команд. */
export interface AdminCityTask { scope: string; type: "number" | "text" | "choice" | "order"; prompt: string; answer?: number; answers?: string[]; options?: string[]; correct?: number; items?: string[] }
export interface AdminCityDto {
  node: { key: string; bookCode: string; cityType: string | null; cityKey: string | null; cityCode: string | null };
  content: { title: string; translation: string; codeRule: string; districts: Array<{ verses: string; title: string; summary: string }>; tasks: AdminCityTask[] } | null;
  teams: Array<{ id: string; index: number; name: string; color: string; orderSolved: boolean; orderAttempts: number; doneTasks: number[]; answerAttempts: number; capturedAt: string | null; isCapital: boolean }>;
}
export const PROOF_LABEL: Record<DeedLite["proofType"], string> = { get REPORT() { return t("отчёт текстом"); }, get PHOTO_LINK() { return t("ссылка на фото"); }, get VIDEO_LINK() { return t("ссылка на видео"); }, get CONFIRMATION() { return t("подтверждение человека"); } };
export const TASK_STATUS_LABEL: Record<EdgeTaskStatus, string> = { get OPEN() { return t("свободно"); }, get TAKEN() { return t("в работе"); }, get SUBMITTED() { return t("на проверке"); }, get APPROVED() { return t("одобрено"); }, get REJECTED() { return t("вернули"); } };

/** Битва за город. Записи чужой стороны команде не видны. */
export type BattleStatus = "QUEUED" | "ATTACK" | "DEFENSE" | "WON" | "REPELLED" | "EXPIRED" | "CANCELLED";
export interface BattleEntryDto { id: string; side: "ATTACK" | "DEFENSE"; userId: string; nickname: string; ref: string; start: number; end: number; verses: number; links: string[]; note: string; status: "SUBMITTED" | "APPROVED" | "REJECTED"; adminComment: string; createdAt: string }
export interface PassageDto { ref: string; start: number; end: number; verses: Array<{ idx: number; ref: string; text: string | null }> | null }
export interface BattleDto {
  id: string; nodeKey: string; bookCode: string; bookName: string; status: BattleStatus; sumMode: boolean; bid: number; defenseBid: number | null;
  attacker: { id: string; index: number; name: string; color: string }; defender: { id: string; index: number; name: string; color: string };
  mySide: "ATTACK" | "DEFENSE" | null; passage: PassageDto | null; defensePassage: PassageDto | null;
  declaredAt: string; startedAt: string | null; attackDeadline: string | null; attackDoneAt: string | null; attackApprovedAt: string | null;
  defenseDeadline: string | null; defenseDoneAt: string | null; resolvedAt: string | null;
  attackSum: number; attackApproved: number; defenseSum: number; defenseApproved: number; entries: BattleEntryDto[]; myVerses: number[]; bookTotal: number | null;
}
export interface BookTextDto { code: string; name: string; verseCounts: number[]; chapters: string[][] | null; total: number }
export interface WarDto { defenseLevel: number; sumMode: boolean; locked: boolean; bookVerses: number | null; penalty: number; minBid: number; canDeclare: boolean; reason: string | null; owner: { id: string; name: string; color: string } | null; queue: number; battles: BattleDto[] }
export const BATTLE_STATUS_LABEL: Record<BattleStatus, string> = { get QUEUED() { return t("в очереди"); }, get ATTACK() { return t("вызов"); }, get DEFENSE() { return t("ответ"); }, get WON() { return t("город перешёл"); }, get REPELLED() { return t("город устоял"); }, get EXPIRED() { return t("вызов не завершён"); }, get CANCELLED() { return t("отменена"); } };

/** Итоги игры: положение команд и победитель. */
export interface CityOnPath { nodeKey: string; bookCode: string; name: string; current: boolean; isCapital: boolean; at: string }
export interface StandingRow { teamId: string; name: string; color: string; index: number; status: string; cities: number; capitals: number; citiesOnPath: CityOnPath[]; deedsApproved: number; nodesRevealed: number; battlesWon: number; battlesLost: number; battlesRepelled: number }
export interface StandingsDto { status: string; finishedAt: string | null; winnerTeamId: string | null; finishReason: string | null; endsAt: string | null; standings: StandingRow[]; leaderTeamId: string | null }

/** Дипломатия: запрос прохода через чужой город. */
export type PassageStatus = "PENDING" | "APPROVED" | "DECLINED" | "EXPIRED" | "REVOKED";
export interface PassageDto { id: string; nodeKey: string; bookName: string; message: string; answer: string; status: PassageStatus; createdAt: string; expiresAt: string; decidedAt: string | null; requester: { id: string; name: string; color: string }; owner: { id: string; name: string; color: string } }
export const PASSAGE_LABEL: Record<PassageStatus, string> = { get PENDING() { return t("ждём ответа"); }, get APPROVED() { return t("разрешён"); }, get DECLINED() { return t("отказ"); }, get EXPIRED() { return t("нет ответа — отказ"); }, get REVOKED() { return t("закрыт"); } };
