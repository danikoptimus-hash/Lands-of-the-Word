/**
 * Расстояние Чебышёва («ходы короля») от каждого пикселя до ближайшего непрозрачного — для обводки картинок городов
 * на карте. Непрозрачный пиксель (альфа ≥ 128) — 0; дальше `maxD` — 255.
 *
 * Считается за два прохода по соседям (вперёд и назад): для этой метрики такой способ даёт точно тот же результат, что
 * прежнее расширение ядром 3×3 шаг за шагом, только вместо `maxD` проходов по квадрату 512×512 — два. По замеру ревизии
 * 15.11 прежний расчёт занимал 0,8 с при открытии карты на быстром процессоре (на телефоне — секунды без отклика).
 *
 * @param rgba пиксели RGBA (как у getImageData), квадрат P×P
 */
export function chebyshevDistance(rgba: ArrayLike<number>, P: number, maxD: number): Uint8Array {
  const FAR = 0xffff, n = P * P;
  const d = new Uint16Array(n);
  for (let i = 0; i < n; i++) d[i] = rgba[i * 4 + 3]! >= 128 ? 0 : FAR;
  // Вперёд: соседи слева и сверху.
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    const i = y * P + x; let v = d[i]!;
    if (v === 0) continue;
    if (x > 0 && d[i - 1]! + 1 < v) v = d[i - 1]! + 1;
    if (y > 0) {
      const u = i - P;
      if (d[u]! + 1 < v) v = d[u]! + 1;
      if (x > 0 && d[u - 1]! + 1 < v) v = d[u - 1]! + 1;
      if (x < P - 1 && d[u + 1]! + 1 < v) v = d[u + 1]! + 1;
    }
    d[i] = v > FAR ? FAR : v;
  }
  // Назад: соседи справа и снизу.
  for (let y = P - 1; y >= 0; y--) for (let x = P - 1; x >= 0; x--) {
    const i = y * P + x; let v = d[i]!;
    if (v === 0) continue;
    if (x < P - 1 && d[i + 1]! + 1 < v) v = d[i + 1]! + 1;
    if (y < P - 1) {
      const u = i + P;
      if (d[u]! + 1 < v) v = d[u]! + 1;
      if (x > 0 && d[u - 1]! + 1 < v) v = d[u - 1]! + 1;
      if (x < P - 1 && d[u + 1]! + 1 < v) v = d[u + 1]! + 1;
    }
    d[i] = v > FAR ? FAR : v;
  }
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = d[i]! <= maxD ? d[i]! : 255;
  return out;
}
