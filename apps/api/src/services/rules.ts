import { z } from "zod";

/**
 * Правила игры, которые раньше были константами в коде (решение владельца 18.09: вынести в «Продвинутые настройки»
 * администратора). Хранятся в Game.settings.rules; отсутствующие поля — значения по умолчанию.
 * Изменение после старта действует с момента сохранения; идущие испытания доигрываются по значениям,
 * уже записанным в них (дедлайны), новые считаются по новым.
 */
export const rulesSchema = z.object({
  /** Минимальная ставка на вызов, стихов. */
  minBid: z.number().int().min(1).max(1000).default(10),
  /** Срок вызова: за столько дней претенденты должны отправить записи на проверку. */
  attackDays: z.number().int().min(1).max(60).default(14),
  /** Штраф к минимальной ставке за сгоревший вызов (для этой команды на этот город). */
  burnPenalty: z.number().int().min(0).max(100).default(5),
  /** Минимальное время ответа хранителей, секунд (техническая защита; блиц законен). */
  minAnswerSeconds: z.number().int().min(10).max(86_400).default(60),
  /** Срок ответа на запрос прохода, дней; молчание — отказ. */
  passageDays: z.number().int().min(1).max(30).default(3),
  /** Закрепление города после отбитого максимума, недель. */
  lockWeeks: z.number().int().min(0).max(52).default(3),
  /** Усталость: через сколько дней без одобренных дел после города уровень защиты начинает убывать. */
  fatigueAfterDays: z.number().int().min(1).max(365).default(28),
  /** Усталость: раз во сколько дней убывает. */
  fatigueStepDays: z.number().int().min(1).max(365).default(14),
  /** Усталость: на сколько стихов за шаг. */
  fatigueStep: z.number().int().min(0).max(100).default(1),
  /** Взятое и не сданное дело возвращается в общий список через столько дней. */
  deedReturnDays: z.number().int().min(1).max(365).default(14),
  /** Смена игровых ролей — не чаще раза в столько дней. */
  roleChangeDays: z.number().int().min(0).max(365).default(7),
  /** Растущая пауза после неверного ответа (и неверного ключа), секунды по ступеням; дальше — последняя ступень. */
  pauseSteps: z.array(z.number().int().min(1).max(86_400)).min(1).max(12).default([20, 60, 300, 900, 3600]),
  /** Осада делами (город с максимумом защиты): длительность, дней. */
  siegeDays: z.number().int().min(1).max(60).default(14),
  /** Осада делами: баллов за одобренное дело по умолчанию (цену отдельных дел админ задаёт в самом деле). */
  siegeDeedPoints: z.number().int().min(0).max(100).default(1),
  /** Недельный ход разведчика и пророка: раз в столько дней. */
  roleCooldownDays: z.number().int().min(1).max(60).default(7),
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
