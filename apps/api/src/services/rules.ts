import { z } from "zod";

/**
 * Правила игры, которые раньше были константами в коде (решение владельца 18.09: вынести в «Продвинутые настройки»
 * администратора). Хранятся в Game.settings.rules; отсутствующие поля — значения по умолчанию.
 * Изменение после старта действует с момента сохранения; идущие испытания доигрываются по значениям,
 * уже записанным в них (дедлайны), новые считаются по новым.
 * Сроки в днях допускают дробные значения (0.01 дня ≈ 15 минут): так проводится ускоренная тестовая партия.
 */
export const rulesSchema = z.object({
  /** Минимальная ставка на вызов, стихов. */
  minBid: z.number().int().min(1).max(1000).default(10),
  /** Срок вызова: за столько дней претенденты должны отправить записи на проверку. */
  attackDays: z.number().min(0.001).max(60).default(14),
  /** Штраф к минимальной ставке за сгоревший вызов (для этой команды на этот город). */
  burnPenalty: z.number().int().min(0).max(100).default(5),
  /** Минимальное время ответа хранителей, секунд (техническая защита; блиц законен). */
  minAnswerSeconds: z.number().int().min(10).max(86_400).default(60),
  /** Срок ответа на запрос прохода, дней; молчание — отказ. */
  passageDays: z.number().min(0.001).max(30).default(3),
  /** Закрепление города после отбитого максимума, недель. */
  lockWeeks: z.number().min(0).max(52).default(3),
  /** Усталость: через сколько дней без одобренных дел после города уровень защиты начинает убывать. */
  fatigueAfterDays: z.number().min(0.001).max(365).default(28),
  /** Усталость: раз во сколько дней убывает. */
  fatigueStepDays: z.number().min(0.001).max(365).default(14),
  /** Усталость: на сколько стихов за шаг. */
  fatigueStep: z.number().int().min(0).max(100).default(1),
  /** Взятое и не сданное дело возвращается в общий список через столько дней. */
  deedReturnDays: z.number().min(0.001).max(365).default(14),
  /** Сколько дел один участник может взять за сутки (скользящие 24 часа с момента взятия); 0 — без ограничения (решение владельца 02.10). */
  maxDeedsPerDay: z.number().int().min(0).max(50).default(0),
  /** Смена игровых ролей — не чаще раза в столько дней. */
  roleChangeDays: z.number().min(0).max(365).default(7),
  /** Растущая пауза после неверного ответа (и неверного ключа), секунды по ступеням; дальше — последняя ступень. */
  pauseSteps: z.array(z.number().int().min(1).max(86_400)).min(1).max(12).default([20, 60, 300, 900, 3600]),
  /** Осада делами (город с максимумом защиты): длительность, дней. */
  siegeDays: z.number().min(0.001).max(60).default(14),
  /** Осада делами: баллов за одобренное дело по умолчанию (цену отдельных дел админ задаёт в самом деле). */
  siegeDeedPoints: z.number().int().min(0).max(100).default(1),
  /** Недельный ход разведчика и пророка: раз в столько дней. */
  roleCooldownDays: z.number().min(0.001).max(60).default(7),
  /** Воскресная летопись: день недели (0 — воскресенье … 6 — суббота) и час по UTC, после которого она уходит. */
  chronicleWeekday: z.number().int().min(0).max(6).default(0),
  chronicleHourUtc: z.number().int().min(0).max(23).default(15),
  /** Окно отправки вызова на проверку по местному времени (решение владельца 02.10): с часа from до часа to; from = to — без ограничения. На ответ хранителей не распространяется. */
  attackSubmitFrom: z.number().int().min(0).max(24).default(8),
  attackSubmitTo: z.number().int().min(0).max(24).default(14),
  /** Часовой пояс игры (IANA) для окна отправки вызова. */
  timeZone: z.string().trim().min(1).max(64).default("Asia/Tashkent"),
  /** Письма администраторам о сдачах: сразу, раз в 3 часа или раз в день одним письмом (решение владельца 18.09, A-13). */
  adminDigest: z.enum(["instant", "3h", "daily"]).default("instant"),
});
export type Rules = z.infer<typeof rulesSchema>;
export const DEFAULT_RULES: Rules = rulesSchema.parse({});
/** Схема для PATCH: любое подмножество полей. */
export const rulesPatchSchema = rulesSchema.partial();

/** Правила из настроек игры (settings.rules), с умолчаниями для отсутствующих полей. */
export function rulesOf(settings: unknown): Rules {
  const raw = (settings as { rules?: unknown } | null)?.rules;
  const parsed = rulesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_RULES;
}

const DAY = 86_400_000;
export const days = (n: number) => n * DAY;

/** Пауза после n-й неверной попытки подряд (n ≥ 1), миллисекунды. */
export function pauseAfter(rules: Rules, wrong: number): number {
  const steps = rules.pauseSteps;
  return (steps[Math.min(Math.max(wrong, 1), steps.length) - 1] ?? steps[steps.length - 1]!) * 1000;
}

/** Час местного времени в поясе игры; при неизвестном поясе — UTC. */
export function localHour(timeZone: string, now = new Date()): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).formatToParts(now).find((p) => p.type === "hour")?.value;
    return Number(h) % 24;
  } catch { return now.getUTCHours(); }
}

/** Окно отправки вызова (решение владельца 02.10): открыто ли сейчас и его границы. from = to — ограничения нет. */
export function attackWindow(rules: Pick<Rules, "attackSubmitFrom" | "attackSubmitTo" | "timeZone">, now = new Date()): { from: number; to: number; timeZone: string; always: boolean; open: boolean; hour: number } {
  const { attackSubmitFrom: from, attackSubmitTo: to, timeZone } = rules;
  const always = from === to;
  const hour = localHour(timeZone, now);
  const open = always || (from < to ? hour >= from && hour < to : hour >= from || hour < to);
  return { from, to, timeZone, always, open, hour };
}
