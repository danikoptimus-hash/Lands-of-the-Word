import { useEffect, useId, useState } from "react";
import { t } from "../lib/i18n";
import { fmtDate, fmtPause } from "../lib/format";

/** Силуэт трёхмачтового парусника в профиль (замечание владельца 05.11: «сделать нормальный силуэт парусника»): корпус с
 *  кормовой надстройкой, три мачты с ярусами прямых парусов, кливер, вымпелы. Поле 200×120, киль у y≈104. */
const SHAPES = [
  "M14 72 L14 86 C40 102 132 104 170 92 L186 74 L178 72 C140 82 60 84 24 76 Z", // корпус: транец, киль, форштевень, палуба с седловатостью
  "M8 62 H44 V73 H8 Z", // кормовая надстройка
  "M68 58 H124 L120 78 Q96 86 72 78 Z", "M73 38 H119 L116 55 Q96 61 76 55 Z", "M80 20 H112 L110 35 Q96 39 82 35 Z", // грот: три яруса
  "M118 62 H166 L162 78 Q142 85 122 78 Z", "M123 44 H161 L158 59 Q142 64 126 59 Z", "M128 28 H156 L154 41 Q142 45 130 41 Z", // фок
  "M28 62 H72 L69 76 Q50 82 31 76 Z", "M33 44 H67 L65 59 Q50 64 35 59 Z", // бизань
  "M144 26 L196 54 L176 70 Z", // кливер
  "M96 8 L114 12 L96 16 Z", "M142 16 L158 19.5 L142 23 Z", "M50 22 L64 25 L50 28 Z", // вымпелы
];
const MASTS: ReadonlyArray<[number, number, number]> = [[50, 22, 76], [96, 8, 80], [142, 16, 78]]; // x, верх, низ
const RIG: ReadonlyArray<[number, number, number, number]> = [[96, 9, 14, 72], [142, 17, 200, 52], [96, 9, 142, 17], [50, 23, 96, 9], [50, 23, 8, 62]]; // штаги

/**
 * Корабль наполняется водой (решение владельца 05.11: «у команды будет в меню этого дела тикать таймер… силуэт корабля,
 * наполняющегося водой в зависимости от таймера»): вода поднимается от появления корабля (appearedAt) к сроку затопления
 * (sinkAt) по всему силуэту, рядом обратный отсчёт раз в секунду. Чистая функция времени, ничего не хранит.
 */
export function SinkingShip({ sinkAt, appearedAt, compact = false }: { sinkAt: string; appearedAt?: string | null; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const tm = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tm); }, []);
  const id = "sink" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const end = Date.parse(sinkAt), start = appearedAt ? Date.parse(appearedAt) : end - 86_400_000;
  const left = end - now, sunk = left <= 0;
  const frac = end <= start ? 1 : Math.min(1, Math.max(0, (now - start) / (end - start)));
  // Уровень воды: от киля (y≈106) до вымпелов (y≈6), к сроку корабль уходит под воду целиком. Волна тянется шире поля — для сдвига анимацией.
  const level = 106 - frac * 100;
  let water = `M-40 ${level.toFixed(1)}`;
  for (let i = 0; i < 7; i++) water += " q10 -2.6 20 0 q10 2.6 20 0";
  water += " V130 H-40 Z";
  const label = sunk ? t("Корабль тонет") : t("Утонет через {t}", { t: fmtPause(left) });
  return (
    <div className={"sinking" + (compact ? " compact" : "") + (sunk ? " sunk" : "")} role="img" aria-label={sunk ? label : t("Корабль наполняется водой: {s}", { s: label })}>
      <svg viewBox="0 0 200 120" aria-hidden="true">
        <defs>
          <clipPath id={id}>
            {SHAPES.map((d, i) => <path key={i} d={d} />)}
            {MASTS.map(([x, y0, y1]) => <rect key={x} x={x - 1.5} y={y0} width={3} height={y1 - y0} />)}
            <polygon points="177,70 179,74 201,53 199,50" />
          </clipPath>
        </defs>
        <g className="ship">{SHAPES.map((d, i) => <path key={i} d={d} />)}</g>
        {MASTS.map(([x, y0, y1]) => <line key={x} className="mast" x1={x} y1={y0} x2={x} y2={y1} />)}
        <line className="mast" x1={178} y1={72} x2={200} y2={52} />
        {RIG.map(([x1, y1, x2, y2], i) => <line key={i} className="rig" x1={x1} y1={y1} x2={x2} y2={y2} />)}
        <g clipPath={`url(#${id})`}><path className="water" d={water} /></g>
      </svg>
      <div className="txt">
        <b>{label}</b>
        <span className="small muted">{t("Срок: {d}", { d: fmtDate(sinkAt) })}</span>
      </div>
    </div>
  );
}
