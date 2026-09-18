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

export interface User { id: string; nickname: string; displayName: string | null; email: string | null; emailVerified: boolean; locale: string; platformRole: "USER" | "SUPERADMIN" }
export interface GameSummary { id: string; name: string; status: string; teamCount: number; mapSeed: number | null; createdAt: string; createdById?: string; org: { name: string } }
export interface MapHexDto { q: number; r: number; terrain?: string; rotation?: number; lit?: boolean; island?: "OT" | "NT" }
export interface MapNodeDto { key: string; corner: "N" | "S"; q: number; r: number; kind: "EMPTY" | "CITY" | "START"; bookCode: string | null; cityType: string | null; teamIndex: number | null; island?: "OT" | "NT"; coastal?: boolean }
export interface MapEdgeDto { aKey: string; bKey: string }

export type TeamRole = "CAPTAIN" | "DEPUTY" | "MEMBER";
export type GameRole = "NONE" | "SCOUT" | "PROPHET" | "AMBASSADOR" | "CHRONICLER" | "HELMSMAN";
export interface MemberDto { role: TeamRole; gameRole: GameRole; pendingRole?: GameRole | null; joinedAt: string; user: { id: string; nickname: string; displayName: string | null } }
export interface TeamDto { id: string; index: number; name: string; color: string; startNodeKey: string | null; status?: string; roleChangeAvailableAt?: string | null; members: MemberDto[] }
export interface MyTeamDto { role: TeamRole; gameRole: GameRole; team: { id: string; name: string; color: string }; game: { id: string; name: string; status: string; org: { name: string } } }

export const GAME_ROLE_LABEL: Record<GameRole, string> = { get NONE() { return t("Без роли"); }, get SCOUT() { return t("Разведчик"); }, get PROPHET() { return t("Пророк"); }, get AMBASSADOR() { return t("Посол"); }, get CHRONICLER() { return t("Летописец"); }, get HELMSMAN() { return t("Кормчий"); } };
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { get CAPTAIN() { return t("капитан"); }, get DEPUTY() { return t("заместитель"); }, get MEMBER() { return t("участник"); } };

export type EdgeTaskStatus = "OPEN" | "TAKEN" | "SUBMITTED" | "APPROVED" | "REJECTED";
export interface DeedLite { id: string; title: string; description: string; direction: string; proofType: "REPORT" | "PHOTO_LINK" | "VIDEO_LINK"; /** Тайное дело: ссылки и описание сдачи видит только тот, кто взял, и администратор. */ secret?: boolean; /** Можно сделать издалека. */ remote?: boolean }
export interface EdgeTaskDto { id: string; fromKey: string; toKey: string; deedId: string; status: EdgeTaskStatus; takenById: string | null; links: string[]; note: string; adminComment: string; submittedAt: string | null; deed: DeedLite; /** Кто участвовал в деле группой. */ participants?: string[]; donation?: boolean; donationAmount?: number | null; /** Морская сторона из порта; landing — одобрено, капитан выбирает место высадки из candidates. */ sea?: boolean; landing?: boolean; candidates?: string[] }
export interface MapCityDto { nodeKey: string; hasContent: boolean; total: number; owner: { index: number; name: string; color: string } | null; orderSolved: boolean; done: number; captured: boolean; isCapital: boolean; battle: "ATTACK" | "DEFENSE" | null; ruined: boolean; blocked: boolean; passage: string | null }
export interface MyMapDto { status: string; team: { id: string; name: string; color: string; startNodeKey?: string | null }; hexes: MapHexDto[]; revealed: MapNodeDto[]; edges: MapEdgeDto[]; tasks: EdgeTaskDto[]; cities: MapCityDto[]; peeked: Array<{ key: string; kind: string }>; /** Чужие пройденные стороны там, где открыт туман. */ foreign?: Array<{ aKey: string; bKey: string; teamIndex: number; color: string }>; /** Только в ответе администратору («глазами команды»): участники, чтобы подписать, кто взял дело. */ members?: Array<{ id: string; nickname: string; displayName: string | null }> }

/** Город глазами команды: районы (сцены книги), задания без ответов, буквы шифра, состояние. */
export interface CityDistrictDto { id: string; verses: string; title: string; summary: string; index: number | null }
export type CityTaskDto =
  | { index: number; scope: string; groupDistricts: number[] | null; type: "number" | "text"; prompt: string }
  | { index: number; scope: string; groupDistricts: number[] | null; type: "choice"; prompt: string; options: string[] }
  | { index: number; scope: string; groupDistricts: number[] | null; type: "order"; prompt: string; items: Array<{ id: string; text: string }> }
  | { index: number; scope: string; groupDistricts: number[] | null; type: "crossword"; prompt: string; rows: number; cols: number; words: CrosswordWordDto[] };
/** Слово кроссворда без букв: номер, клетка начала, направление, длина и вопрос. Ответ — слова в порядке этого списка. */
export interface CrosswordWordDto { n: number; row: number; col: number; dir: "across" | "down"; len: number; clue: string }
/** Блокировка задания с выбором ответа (две попытки → сутки) и спор с админом. */
export interface TaskLockDto { index: number; wrong: number; lockedUntil: number | null; unlocked: boolean }
/** Обращение команды в поддержку по городу: открытое или закрытое с ответом (две недели). */
export interface SupportItemDto { id: string; taskIndex: number | null; createdAt: number; status: "OPEN" | "CLOSED"; reply: string | null; unlocked: boolean }
export interface MyCityDto {
  node: { key: string; bookCode: string; cityType: string | null; ruined: boolean };
  /** Адресат конверта: только когда все задания решены. */
  recipient?: { label: string; kind: "FAMILY" | "WIDOW" | "ELDER" | "OTHER" } | null;
  owner: { id: string; index: number; name: string; color: string } | null;
  team: { capitalMovedAt: string | null; gameRole: GameRole; role: TeamRole };
  content: { title: string; translation: string; codeRule: string; districts: CityDistrictDto[]; tasks: CityTaskDto[]; fragments: Array<string | null> } | null;
  state: { orderSolved: boolean; orderAttempts: number; doneTasks: number[]; capturedAt: string | null; isCapital: boolean; secondCapital: boolean; hintTasks: number[]; /** Свеча пророка: когда подсказка снова доступна (0 — сейчас); не пророку null. */ hintAvailableAt: number | null; keyLockedUntil: number | null; keyWrong: number; pauseSteps: number[]; locks: TaskLockDto[]; support: SupportItemDto[] };
}
/** Город глазами админа: контент с ответами, ключ конверта, прогресс команд. */
export interface AdminCityTask { scope: string; type: "number" | "text" | "choice" | "order" | "crossword"; prompt: string; answer?: number; answers?: string[]; options?: string[]; correct?: number; items?: string[]; words?: Array<{ clue: string; answer?: string; len?: number }> }
export interface AdminCityDto {
  node: { key: string; bookCode: string; cityType: string | null; cityKey: string | null; cityCode: string | null };
  content: { title: string; translation: string; codeRule: string; districts: Array<{ verses: string; title: string; summary: string }>; tasks: AdminCityTask[] } | null;
  teams: Array<{ id: string; index: number; name: string; color: string; orderSolved: boolean; orderAttempts: number; doneTasks: number[]; answerAttempts: number; capturedAt: string | null; isCapital: boolean }>;
  /** Ответы видит только администратор платформы; администратору игры приходят задания без ответов. */
  answersHidden?: boolean;
}
export const PROOF_LABEL: Record<DeedLite["proofType"], string> = { get REPORT() { return t("отчёт"); }, get PHOTO_LINK() { return t("фото"); }, get VIDEO_LINK() { return t("видео"); } };
/** Осада делами (город с максимумом защиты). */
export interface SiegeDto { id: string; status: "ACTIVE" | "WON" | "REPELLED" | "CANCELLED"; startedAt: string; endsAt: string; attackerPoints: number; defenderPoints: number; attacker: { id: string; name: string; color: string } | null; defender: { id: string; name: string; color: string } | null; mine: "ATTACK" | "DEFENSE" }
export interface SiegeInfoDto { available: boolean; canDeclare: boolean; reason: string | null; days: number; deedPoints: number; list: SiegeDto[] }
export const TASK_STATUS_LABEL: Record<EdgeTaskStatus, string> = { get OPEN() { return t("свободно"); }, get TAKEN() { return t("в работе"); }, get SUBMITTED() { return t("на проверке"); }, get APPROVED() { return t("принято"); }, get REJECTED() { return t("возвращено"); } };

/** Битва за город. Записи чужой стороны команде не видны. */
export type BattleStatus = "QUEUED" | "ATTACK" | "DEFENSE" | "WON" | "REPELLED" | "EXPIRED" | "CANCELLED";
export interface BattleEntryDto { id: string; side: "ATTACK" | "DEFENSE"; userId: string; nickname: string; ref: string; start: number; end: number; verses: number; links: string[]; note: string; status: "SUBMITTED" | "APPROVED" | "REJECTED"; adminComment: string; carried?: boolean; createdAt: string }
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
export interface WarDto { defenseLevel: number; sumMode: boolean; locked: boolean; lockedUntil?: string | null; maxed?: boolean; siege?: SiegeInfoDto; bookVerses: number | null; penalty: number; minBid: number; attackDays?: number; burnPenalty?: number; canDeclare: boolean; reason: string | null; owner: { id: string; name: string; color: string } | null; queue: number; battles: BattleDto[] }
export const BATTLE_STATUS_LABEL: Record<BattleStatus, string> = { get QUEUED() { return t("в очереди"); }, get ATTACK() { return t("вызов"); }, get DEFENSE() { return t("ответ"); }, get WON() { return t("город перешёл"); }, get REPELLED() { return t("город устоял"); }, get EXPIRED() { return t("вызов не завершён"); }, get CANCELLED() { return t("отменено"); } };

/** Итоги игры: положение команд и победитель. */
export interface CityOnPath { nodeKey: string; bookCode: string; name: string; current: boolean; isCapital: boolean; at: string }
export interface StandingRow { teamId: string; name: string; color: string; index: number; status: string; cities: number; capitals: number; citiesOnPath: CityOnPath[]; deedsApproved: number; nodesRevealed: number; battlesWon: number; battlesLost: number; battlesRepelled: number }
export interface StandingsDto { status: string; finishedAt: string | null; winnerTeamId: string | null; finishReason: string | null; endsAt: string | null; standings: StandingRow[]; leaderTeamId: string | null }

/** Дипломатия: запрос прохода через чужой город. */
export type PassageStatus = "PENDING" | "APPROVED" | "DECLINED" | "EXPIRED" | "REVOKED";
export interface PassageDto { id: string; nodeKey: string; bookName: string; message: string; answer: string; status: PassageStatus; createdAt: string; expiresAt: string; decidedAt: string | null; requester: { id: string; name: string; color: string }; owner: { id: string; name: string; color: string } }
export const PASSAGE_LABEL: Record<PassageStatus, string> = { get PENDING() { return t("ждём ответа"); }, get APPROVED() { return t("разрешён"); }, get DECLINED() { return t("отказано"); }, get EXPIRED() { return t("без ответа"); }, get REVOKED() { return t("закрыт"); } };
