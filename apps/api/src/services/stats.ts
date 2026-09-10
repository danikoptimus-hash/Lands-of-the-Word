/**
 * Техника для дашборда: запросы, ошибки и время ответа с момента запуска процесса (в памяти).
 * Время ответа хранится в кольце последних 2000 запросов к /api — по нему считаются среднее и p95.
 */
export const stats = { startedAt: Date.now(), requests: 0, errors5xx: 0, errors4xx: 0, lastErrorAt: null as string | null, lastErrorRoute: null as string | null };
const ring: number[] = [];
const RING = 2000;

export function recordResponse(status: number, ms: number, route: string): void {
  stats.requests++;
  if (status >= 500) { stats.errors5xx++; stats.lastErrorAt = new Date().toISOString(); stats.lastErrorRoute = route; }
  else if (status >= 400) stats.errors4xx++;
  ring.push(ms);
  if (ring.length > RING) ring.shift();
}

export function responseTimes(): { avgMs: number | null; p95Ms: number | null; sample: number } {
  if (ring.length === 0) return { avgMs: null, p95Ms: null, sample: 0 };
  const sorted = [...ring].sort((a, b) => a - b);
  const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length * 10) / 10;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
  return { avgMs: avg, p95Ms: Math.round(p95 * 10) / 10, sample: sorted.length };
}
