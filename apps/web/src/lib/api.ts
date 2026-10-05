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

export interface User { id: string; nickname: string; displayName: string | null; email: string | null; emailVerified: boolean; locale: string; platformRole: "USER" | "SUPERADMIN"; /** К учётке привязан вход через Google. */ googleLinked?: boolean }
/** Какие способы входа включены на сервере (GET /api/auth/providers). */
export interface ProvidersDto { google: boolean }
export interface GameSummary { id: string; name: string; status: string; teamCount: number; mapSeed: number | null; createdAt: string; createdById?: string; org: { name: string } }
export interface MapHexDto { q: number; r: number; terrain?: string; rotation?: number; lit?: boolean; island?: "OT" | "NT" }
export interface MapNodeDto { key: string; corner: "N" | "S"; q: number; r: number; kind: "EMPTY" | "CITY" | "START"; bookCode: string | null; cityType: string | null; teamIndex: number | null; island?: "OT" | "NT"; coastal?: boolean }
export interface MapEdgeDto { aKey: string; bKey: string }

export type TeamRole = "CAPTAIN" | "DEPUTY" | "MEMBER";
export type GameRole = "NONE" | "SCOUT" | "PROPHET" | "AMBASSADOR" | "CHRONICLER" | "HELMSMAN" | "WARRIOR";
export interface MemberDto { role: TeamRole; gameRole: GameRole; pendingRole?: GameRole | null; joinedAt: string; user: { id: string; nickname: string; displayName: string | null }; /** Лимит дел в сутки этого участника (null — лимита нет): взято за сутки и когда можно взять следующее. Видит вся команда. */ deedLimit?: { max: number; taken: number; nextAt: number | null } | null; /** Дела, которые участник сейчас держит (взятые, на проверке, возвращённые); видят администратор и вся команда. */ activeDeeds?: Array<{ id: string; title: string; status: string; takenAt: string | null; submittedAt: string | null }> }
export interface TeamDto { id: string; index: number; name: string; color: string; startNodeKey: string | null; status?: string; roleChangeAvailableAt?: string | null; members: MemberDto[]; /** Тёсаные камни Каменоломни. */ stones?: number }
export interface MyTeamDto { role: TeamRole; gameRole: GameRole; team: { id: string; name: string; color: string }; game: { id: string; name: string; status: string; org: { name: string } } }

/** Значок роли (общий для состава команды и блока «Команды» администратора). */
export const GAME_ROLE_ICON: Record<GameRole, string> = { NONE: "user", SCOUT: "telescope", PROPHET: "sparkle", AMBASSADOR: "handshake", CHRONICLER: "edit", HELMSMAN: "ship", WARRIOR: "sword" };
export const GAME_ROLE_LABEL: Record<GameRole, string> = { get NONE() { return t("Без роли"); }, get SCOUT() { return t("Разведчик"); }, get PROPHET() { return t("Пророк"); }, get AMBASSADOR() { return t("Посол"); }, get CHRONICLER() { return t("Летописец"); }, get HELMSMAN() { return t("Кормчий"); }, get WARRIOR() { return t("Воин"); } };
export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { get CAPTAIN() { return t("капитан"); }, get DEPUTY() { return t("заместитель"); }, get MEMBER() { return t("участник"); } };

export type EdgeTaskStatus = "OPEN" | "TAKEN" | "SUBMITTED" | "APPROVED" | "REJECTED";
export interface DeedLite { id: string; title: string; description: string; direction: string; proofType: "REPORT" | "PHOTO_LINK" | "VIDEO_LINK" | "AUDIO_LINK" | "WITNESS"; /** Тайное дело: ссылки и описание сдачи видит только тот, кто взял, и администратор. */ secret?: boolean; /** Можно сделать издалека. */ remote?: boolean; /** Минимальное пожертвование вместо этого дела; пусто — нельзя (ценник у каждого дела свой). */ donationMin?: number | null }
export interface EdgeTaskDto { id: string; fromKey: string; toKey: string; deedId: string; status: EdgeTaskStatus; takenById: string | null; links: string[]; note: string; adminComment: string; submittedAt: string | null; /** Когда администратор решил (одобрил или вернул). */ decidedAt?: string | null; deed: DeedLite; /** Кто участвовал в деле группой. */ participants?: string[]; donation?: boolean; donationAmount?: number | null; /** Морская сторона из порта; landing — одобрено, капитан выбирает место высадки из candidates. */ sea?: boolean; landing?: boolean; candidates?: string[]; /** Сторона вымощена камнем Каменоломни. */ paved?: boolean }
export interface MapCityDto { nodeKey: string; hasContent: boolean; total: number; owner: { index: number; name: string; color: string } | null; orderSolved: boolean; done: number; captured: boolean; isCapital: boolean; battle: "ATTACK" | "DEFENSE" | null; ruined: boolean; blocked: boolean; passage: string | null }
/** Метка команды: q, r — гекс; qf, rf — точное место нажатия дробными координатами; by — кто поставил. */
export interface MapMarkDto { id: string; q: number; r: number; qf: number; rf: number; note: string; by: { id: string; name: string }; /** Когда поставлена (видно по нажатию: команде и администратору «глазами команды»). */ createdAt?: string }
export interface MyMapDto { status: string; daytime?: DaytimeDto; team: { id: string; name: string; color: string; startNodeKey?: string | null; /** Тёсаные камни Каменоломни (решение владельца 04.10). */ stones?: number }; hexes: MapHexDto[]; revealed: MapNodeDto[]; edges: MapEdgeDto[]; tasks: EdgeTaskDto[]; cities: MapCityDto[]; peeked: Array<{ key: string; kind: string }>; /** Край тумана: ещё не открытые углы освещённых гексов (решение владельца 02.10) — точки, которые разведчик может разведать. */ frontier?: string[]; /** Метки команды на гексах: видит вся команда (решение владельца 22.09). */ marks?: MapMarkDto[]; /** Чужие пройденные стороны там, где открыт туман. */ foreign?: Array<{ aKey: string; bKey: string; teamIndex: number; color: string }>; /** Только в ответе администратору («глазами команды»): участники, чтобы подписать, кто взял дело. */ members?: Array<{ id: string; nickname: string; displayName: string | null }>; /** Суточный полёт клина птиц к ближайшему неоткрытому городу команды: узел и момент (мс сервера), раз в сутки в своё случайное время. */ dailyBird?: DailyBirdDto | null; /** Для живности: семя мира и часы сервера (мс). */ gameId?: string; now?: number; /** Лимит дел в сутки для текущего участника (null — лимита нет): взято за последние 24 часа и когда освободится место. */ deedLimit?: { max: number; taken: number; nextAt: number | null } | null }
/** Полёт клина: момент всегда, узел города — только в окне полёта (сервер отдаёт его за минуту до старта и пять минут после). */
export interface DailyBirdDto { key?: string; at: number }
/** Время суток игры (решение владельца 03.10): фаза правил, пояс и часы сервера. */
export interface DaytimeDto { phase: "morning" | "day" | "evening" | "night"; timeZone: string; now: number; /** Задания города открыты (до полуночи, решение владельца 04.10). */ tasksOpen?: boolean }

/** Город глазами команды: районы (сцены книги), задания без ответов, буквы шифра, состояние. */
export interface CityDistrictDto { id: string; verses: string; title: string; summary: string; index: number | null }
export type CityTaskDto =
  | { index: number; scope: string; groupDistricts: number[] | null; type: "number" | "text"; prompt: string }
  | { index: number; scope: string; groupDistricts: number[] | null; type: "choice"; prompt: string; options: string[] }
  | { index: number; scope: string; groupDistricts: number[] | null; type: "order"; prompt: string; items: Array<{ id: string; text: string }> }
  | { index: number; scope: string; groupDistricts: number[] | null; type: "crossword"; prompt: string; rows: number; cols: number; words: CrosswordWordDto[] };
/** Слово кроссворда без букв: номер, клетка начала, направление, длина и вопрос. Ответ — слова в порядке этого списка. */
export interface CrosswordWordDto { n: number; row: number; col: number; dir: "across" | "down"; len: number; clue: string }
/** Растущая пауза задания после неверных ответов: сколько ошибок подряд и до какого момента ответ не принимается. */
export interface TaskLockDto { index: number; wrong: number; lockedUntil: number | null }
/** Обращение команды в поддержку по городу: открытое или закрытое с ответом (две недели). */
export interface SupportItemDto { id: string; taskIndex: number | null; createdAt: number; status: "OPEN" | "CLOSED"; reply: string | null }
export interface MyCityDto {
  daytime?: DaytimeDto;
  node: { key: string; bookCode: string; cityType: string | null; ruined: boolean };
  /** Адресат конверта: только когда все задания решены. */
  recipient?: { label: string; kind: "FAMILY" | "WIDOW" | "ELDER" | "OTHER" } | null;
  owner: { id: string; index: number; name: string; color: string } | null;
  team: { capitalMovedAt: string | null; gameRole: GameRole; role: TeamRole };
  content: { title: string; translation: string; codeRule: string; districts: CityDistrictDto[]; tasks: CityTaskDto[]; fragments: Array<string | null> } | null;
  state: { orderSolved: boolean; orderAttempts: number; doneTasks: number[]; capturedAt: string | null; isCapital: boolean; secondCapital: boolean; hintTasks: number[]; /** Свеча пророка: когда подсказка снова доступна (0 — сейчас); не пророку null. */ hintAvailableAt: number | null; keyLockedUntil: number | null; keyWrong: number; /** Ключ после половины команды (решение владельца 05.10): сколько участников решали задания этого города, сколько в команде и сколько нужно для ключа. */ solvers?: number; members?: number; needSolvers?: number; pauseSteps: number[]; locks: TaskLockDto[]; support: SupportItemDto[]; /** Черновики расстановки (общие для команды): районов и заданий «по порядку» по номеру задания. */ orderDraft: string[]; taskDrafts: Record<string, string[]> };
}
/** Город глазами админа: контент с ответами, ключ конверта, прогресс команд. */
export interface AdminCityTask { scope: string; type: "number" | "text" | "choice" | "order" | "crossword"; prompt: string; answer?: number; answers?: string[]; options?: string[]; correct?: number; items?: string[]; words?: Array<{ clue: string; answer?: string; len?: number }> }
export interface AdminCityDto {
  node: { key: string; bookCode: string; cityType: string | null; cityKey: string | null; cityCode: string | null };
  /** Адресат конверта этого города (семья, вдова, старица) или null, если список адресатов не ведётся. */
  recipient?: { label: string; kind: "FAMILY" | "WIDOW" | "ELDER" | "OTHER" } | null;
  /** Защита города (только у взятого кем-то города): уровень, режим суммы, закрепление, когда уровень растает на fatigueStep. */
  defense?: { level: number; sumMode: boolean; lockedUntil: string | null; fatigueNextAt: string | null; fatigueStep: number } | null;
  content: { title: string; translation: string; codeRule: string; districts: Array<{ verses: string; title: string; summary: string }>; tasks: AdminCityTask[] } | null;
  teams: Array<{ id: string; index: number; name: string; color: string; orderSolved: boolean; orderAttempts: number; doneTasks: number[]; answerAttempts: number; capturedAt: string | null; isCapital: boolean; /** Минимальная ставка этой команды для вызова (null — вызов невозможен: нет владельца, сама владеет или город закреплён). */ minBid?: number | null; penalty?: number }>;
  /** Ответы видит только администратор платформы; администратору игры приходят задания без ответов. */
  answersHidden?: boolean;
}
export const PROOF_LABEL: Record<DeedLite["proofType"], string> = { get REPORT() { return t("отчёт"); }, get PHOTO_LINK() { return t("фото"); }, get VIDEO_LINK() { return t("видео"); }, get AUDIO_LINK() { return t("аудио"); }, get WITNESS() { return t("свидетель"); } };
/** Осада делами (город с максимумом защиты). */
export interface SiegeDto { id: string; status: "ACTIVE" | "WON" | "REPELLED" | "CANCELLED"; startedAt: string; endsAt: string; attackerPoints: number; defenderPoints: number; attacker: { id: string; name: string; color: string } | null; defender: { id: string; name: string; color: string } | null; mine: "ATTACK" | "DEFENSE" }
export interface SiegeInfoDto { available: boolean; canDeclare: boolean; reason: string | null; days: number; deedPoints: number; list: SiegeDto[] }
export const TASK_STATUS_LABEL: Record<EdgeTaskStatus, string> = { get OPEN() { return t("свободно"); }, get TAKEN() { return t("в работе"); }, get SUBMITTED() { return t("на проверке"); }, get APPROVED() { return t("принято"); }, get REJECTED() { return t("возвращено"); } };

/** Журнал событий (этап 4 решений 18.09): лента, новости, «Моё служение», мир, доска активности, «Книга сезона». */
export type JournalKind = "deed_submitted" | "deed_approved" | "deed_returned" | "order_solved" | "task_solved" | "city_captured" | "ruins_taken" | "treasure" | "trial_declared" | "trial_queued" | "trial_started" | "trial_repelled" | "trial_won" | "trial_burnt" | "trial_cancelled" | "trial_peace" | "siege_peace" | "trade_proposed" | "trade_countered" | "trade_done" | "trade_cancelled" | "siege_declared" | "siege_won" | "siege_repelled" | "passage_granted" | "passage_denied" | "sea_landed" | "penalty" | "role_changed" | "capital_moved" | "peace_offered" | "peace_made" | "peace_declined" | "peace_broken" | "chronicle" | "game_finished";
export interface FeedItemDto { id: string; kind: JournalKind; vars: Record<string, string | number>; text: string; everyone: boolean; mine?: boolean; at: number; /** Только администратору: дело, к которому относится запись (отчёт открывается нажатием). */ taskId?: string | null }
/** Сдача дела для администратора: кто взял и участвовал, ссылки, текст, решение. */
export interface AdminTaskDto { id: string; fromKey: string; toKey: string; status: EdgeTaskStatus; sea: boolean; team: { id: string; name: string; color: string }; deed: DeedLite; takenBy: { id: string; name: string } | null; participants: Array<{ id: string; name: string }>; links: string[]; note: string; donation: boolean; donationAmount: number | null; submittedAt: string | null; decidedAt: string | null; decidedBy: string | null; adminComment: string; createdAt: string }
export interface ServiceStatsDto { deeds: number; deedsPending: number; tasks: number; orders: number; cities: number; verses: number; trips: number; lastActiveAt: number | null }
/** Общий топ участников (всем игрокам): место, имя, команда и числа служения. */
export interface TopRowDto { rank: number; userId: string; name: string; team: string; color: string; deeds: number; tasks: number; cities: number; verses: number; trips: number }
export interface TopDto { rows: TopRowDto[]; me: TopRowDto | null; total: number }
export interface ActivityRowDto extends ServiceStatsDto { userId: string; nickname: string; displayName: string | null; team: string; color: string; role: TeamRole; gameRole: GameRole }
export interface PeaceTeamDto { team: { id: string; name: string; color: string; status: string }; state: "none" | "peace" | "offered" | "incoming"; peaceId: string | null; since: string | null }
export interface SeasonBookDto {
  game: { name: string; org: string; startedAt: string | null; finishedAt: string | null; winnerTeamId: string | null; status: string };
  standings: StandingRow[];
  teams: Array<{ id: string; name: string; color: string; status: string; members: Array<ServiceStatsDto & { userId: string; name: string; role: TeamRole; gameRole: GameRole }>; cities: Array<{ nodeKey: string; book: string; capturedAt: string | null; firstCapturedAt: string | null; isCapital: boolean }>; deeds: Array<{ title: string; direction: string; decidedAt: string | null; by: string[] }> }>;
  events: Array<{ id: string; kind: JournalKind; vars: Record<string, string | number>; text: string; at: string }>;
}

/** Битва за город. Записи чужой стороны команде не видны. */
export type BattleStatus = "QUEUED" | "ATTACK" | "DEFENSE" | "WON" | "REPELLED" | "EXPIRED" | "CANCELLED";
export interface BattleEntryDto { id: string; side: "ATTACK" | "DEFENSE"; userId: string; nickname: string; ref: string; start: number; end: number; verses: number; weight?: number; links: string[]; note: string; status: "SUBMITTED" | "APPROVED" | "REJECTED"; adminComment: string; carried?: boolean; createdAt: string }
export interface PassageDto { ref: string; start: number; end: number; verses: Array<{ idx: number; ref: string; text: string | null }> | null }
export interface BattleDto {
  id: string; nodeKey: string; bookCode: string; bookName: string; status: BattleStatus; sumMode: boolean; bid: number; defenseBid: number | null;
  attacker: { id: string; index: number; name: string; color: string }; defender: { id: string; index: number; name: string; color: string };
  mySide: "ATTACK" | "DEFENSE" | null; passage: PassageDto | null; defensePassage: PassageDto | null;
  declaredAt: string; startedAt: string | null; attackDeadline: string | null; attackDoneAt: string | null; attackApprovedAt: string | null;
  defenseDeadline: string | null; defenseDoneAt: string | null; resolvedAt: string | null;
  attackSum: number; attackApproved: number; defenseSum: number; defenseApproved: number; entries: BattleEntryDto[]; myVerses: number[]; /** Стихи, уже принятые у меня в прошлых испытаниях этой книги: второй раз не сдаются. */ learnedVerses?: number[]; bookTotal: number | null;
}
export interface BookTextDto { code: string; name: string; verseCounts: number[]; chapters: string[][] | null; total: number }
/** Окно отправки вызова по местному времени игры (решение владельца 02.10); на ответ хранителей не распространяется. */
export interface WarDto { defenseLevel: number; sumMode: boolean; locked: boolean; lockedUntil?: string | null; maxed?: boolean; siege?: SiegeInfoDto; bookVerses: number | null; penalty: number; minBid: number; attackDays?: number; burnPenalty?: number; canDeclare: boolean; reason: string | null; owner: { id: string; name: string; color: string } | null; queue: number; battles: BattleDto[]; daytime?: DaytimeDto }
export const BATTLE_STATUS_LABEL: Record<BattleStatus, string> = { get QUEUED() { return t("в очереди"); }, get ATTACK() { return t("вызов"); }, get DEFENSE() { return t("ответ"); }, get WON() { return t("город перешёл"); }, get REPELLED() { return t("город устоял"); }, get EXPIRED() { return t("вызов не завершён"); }, get CANCELLED() { return t("отменено"); } };

/** Итоги игры: положение команд и победитель. */
export interface CityOnPath { nodeKey: string; bookCode: string; name: string; current: boolean; isCapital: boolean; at: string }
export interface StandingRow { teamId: string; name: string; color: string; index: number; status: string; cities: number; capitals: number; citiesOnPath: CityOnPath[]; deedsApproved: number; nodesRevealed: number; battlesWon: number; battlesLost: number; battlesRepelled: number }
export interface StandingsDto { status: string; finishedAt: string | null; winnerTeamId: string | null; finishReason: string | null; endsAt: string | null; standings: StandingRow[]; leaderTeamId: string | null }

/** Дипломатия: запрос прохода через чужой город. */
/** Обмен городами между послами (решение владельца 04.10). */
export interface TradeCityDto { nodeKey: string; bookCode: string; bookName: string; words: number }
export interface TradeDto { id: string; status: "OPEN" | "COUNTERED" | "DONE" | "CANCELLED"; from: { id: string; name: string; color: string }; to: { id: string; name: string; color: string }; mine: boolean; message: string; offer: TradeCityDto; counter: TradeCityDto | null; declined: TradeCityDto[]; createdAt: string; updatedAt: string; closedAt: string | null; closedByMe: boolean }
export interface TradesDto { canTrade: boolean; teams: Array<{ id: string; name: string; color: string }>; myCities: Array<TradeCityDto & { capital: boolean; reason: string | null }>; trades: TradeDto[] }
export type PassageStatus = "PENDING" | "APPROVED" | "DECLINED" | "EXPIRED" | "REVOKED";
export interface PassageDto { id: string; nodeKey: string; bookName: string; message: string; answer: string; status: PassageStatus; createdAt: string; expiresAt: string; decidedAt: string | null; requester: { id: string; name: string; color: string }; owner: { id: string; name: string; color: string } }
export const PASSAGE_LABEL: Record<PassageStatus, string> = { get PENDING() { return t("ждём ответа"); }, get APPROVED() { return t("разрешён"); }, get DECLINED() { return t("отказано"); }, get EXPIRED() { return t("без ответа"); }, get REVOKED() { return t("сброшен: город сменил владельца"); } };

/** Каменоломня (решение владельца 04.10): общие дела команды, сдачи и камни. */
export interface QuarryWorkDto { id: string; deedId: string; title: string; status: "SUBMITTED" | "APPROVED" | "REJECTED"; stones: number; by: string; links: string[]; note: string; submittedAt: string; decidedAt: string | null; adminComment: string }
export interface QuarryDto { stones: number; canWork: boolean; deeds: Array<{ id: string; title: string; description: string; direction: string; proofType: string; stones: number }>; works: QuarryWorkDto[] }
