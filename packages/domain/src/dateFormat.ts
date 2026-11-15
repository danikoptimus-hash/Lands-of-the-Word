/**
 * Готовые форматтеры дат (ревизия скорости 15.11). Создать `Intl.DateTimeFormat` в 13–15 раз дороже, чем вызвать готовый
 * (62–65 мкс против 4–5): пересчёт наград на сервере занимал 329 мс вместо 24, на клиенте это была первая строка профиля.
 * Форматтер создаётся один раз на ключ (вид + пояс) и живёт, пока жив процесс: поясов и видов единицы.
 * Неверный пояс бросает RangeError из `make`, как и сам конструктор, — в память такой ключ не попадает.
 */
const formats = new Map<string, Intl.DateTimeFormat>();
export function cachedFormat(key: string, make: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let f = formats.get(key);
  if (!f) { f = make(); formats.set(key, f); }
  return f;
}
