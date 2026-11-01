/**
 * Тайна вызова (решения владельца 31.10 и 01.11): хранители не знают о вызове своему городу, пока капитан претендентов
 * не нажал «Испытать» (статус DEFENSE). Исключение — вызов, нарушивший мир: он объявляется всем сразу (решение владельца
 * 22.10: хранители зовут союзника заранее). Правило одно для списков испытаний, окна города и значков на карте.
 */
export const battleVisibleTo = (b: { attackerId: string; defenderId: string; status: string; violation: boolean; defenseFactor: number }, teamId: string): boolean =>
  !(b.defenderId === teamId && b.attackerId !== teamId && (b.status === "QUEUED" || b.status === "ATTACK") && !b.violation && b.defenseFactor <= 1);
