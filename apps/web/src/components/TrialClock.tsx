import { useEffect, useState } from "react";
import type { ClockDto } from "../lib/api";
import { t } from "../lib/i18n";
import { Icon } from "./Icon";

/**
 * Часы испытания (решение владельца 03.11: «чтобы при нажатии видно было время, сколько на таймере получилось от момента
 * старта таймера… чтобы это и во время заучивания было видно, таймер тикал. И чтобы, когда уже отправлен на проверку,
 * таймер остановился, но был виден»). Сервер присылает, сколько натикало к моменту ответа и идут ли часы; пока идут,
 * циферблат дотикивает сам раз в секунду. У хранителей под цифрами — полоска: какая часть отпущенного времени прошла.
 */
export function ClockFace({ clock, kind }: { clock: ClockDto; /** Чьи часы: вызова (претенденты) или ответа (хранители). */ kind: "attack" | "defense" }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!clock.running) return;
    setNow(Date.now());
    const tm = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tm);
  }, [clock.running, clock.at]);
  const ms = clockMs(clock, now);
  const state = clock.running ? t("идут") : clock.why === "review" ? t("стоят: на проверке") : clock.why === "night" ? t("стоят: ночь") : clock.why === "storm" ? t("стоят: шторм") : t("итог");
  return (
    <div className={"trial-clock " + kind + (clock.running ? " running" : "")} role="timer">
      <span className="face"><Icon name={clock.running ? "hourglass" : "clock"} /><b>{fmtClock(ms)}</b></span>
      {clock.limit != null && clock.limit > 0 && <span className="bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (100 * ms) / clock.limit)}%` }} /></span>}
      <span className="why">{kind === "attack" ? t("время вызова") : t("время ответа")} · {state}</span>
    </div>
  );
}

/** Сколько натикало к этой секунде: пока часы идут, к серверному `ms` прибавляется время с момента ответа сервера. */
export function clockMs(c: ClockDto, now = Date.now()): number {
  return c.ms + (c.running ? Math.max(0, now - Date.parse(c.at)) : 0);
}

/** «0:12:34» или «2 д 5:06:07»: часы без ведущего нуля, минуты и секунды — по две цифры. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const hms = `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return d > 0 ? t("{d} д {t}", { d, t: hms }) : hms;
}
