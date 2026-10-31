import type { BattleDto } from "../lib/api";
import { t } from "../lib/i18n";
import { fmtDate, fmtLeft, plural } from "../lib/format";
import { Icon } from "../components/Icon";

/**
 * Схема испытания (решение владельца 31.10: «красивую пошаговую схему из этапов для каждой атаки… всю схему блеклой,
 * а завершённые и текущие этапы явно… не понятно, на чьей стороне мяч»). Шесть этапов цикла «вызов → ответ»:
 * вызов объявлен → претенденты учат стихи → администратор проверяет вызов → хранители учат ответ → администратор
 * проверяет ответ → итог. Медальоны — картинки `/img/trial/<этап>.webp` в стиле значков наград. Пройденные этапы
 * с галочкой, текущий — с пульсирующим кольцом, будущие — серые и бледные, сорванный — с крестом. Над схемой строка
 * «чей ход» с тем, что именно сейчас должно произойти. Одна и та же схема у администратора, претендентов и хранителей;
 * хранителям и союзникам счёт ответа виден, претендентам — нет (как и раньше).
 */
type StepState = "done" | "current" | "future" | "failed";
interface Step { key: string; icon: string; cap: string; sub: string; state: StepState }
type Who = "attacker" | "defender" | "admin" | "none" | "over";
export interface Turn { who: Who; mine: boolean; text: string; detail: string }

const verses = (n: number) => plural(n, ["стих", "стиха", "стихов"]);
const day = (iso: string | null) => (iso ? fmtDate(iso, { time: false }) : "");
const live = (b: BattleDto) => b.status === "QUEUED" || b.status === "ATTACK" || b.status === "DEFENSE";
const left = (iso: string | null, now: number) => { if (!iso) return ""; const ms = Date.parse(iso) - now; return ms <= 0 ? t("время вышло") : fmtLeft(ms); };

/** Чей ход и что должно произойти. teamId — команда зрителя (у администратора нет). */
export function trialTurn(b: BattleDto, teamId: string | null, now = Date.now()): Turn {
  const need = b.defenseNeed ?? b.bid;
  const attacker = teamId === b.attacker.id, defender = teamId === b.defender.id || b.myAlliance?.status === "ACTIVE";
  switch (b.status) {
    case "QUEUED": return { who: "none", mine: false, text: t("Очередь: вызов начнётся, когда закончится идущее испытание города"), detail: "" };
    case "ATTACK":
      if (!b.attackDoneAt) return { who: "attacker", mine: attacker, text: attacker ? t("Ваш ход: учите стихи, капитан отправляет вызов на проверку") : t("Ход претендентов «{team}»: учат стихи", { team: b.attacker.name }), detail: `${t("выучено {a} из {b}", { a: b.attackSum, b: b.bid })} · ${t("до {d}", { d: fmtDate(b.attackDeadline) })} · ${t("осталось {t}", { t: left(b.attackDeadline, now) })}` };
      return { who: "admin", mine: false, text: t("Ход администратора: проверяет записи вызова"), detail: t("принято {a} из {b}", { a: b.attackApproved, b: b.bid }) };
    case "DEFENSE":
      if (!b.defenseDoneAt) return { who: "defender", mine: defender, text: defender ? t("Ваш ход: учите ответ, капитан отправляет его на проверку") : t("Ход хранителей «{team}»: учат ответ", { team: b.defender.name }), detail: `${defender || !teamId ? t("выучено {a} из {b}", { a: b.defenseSum, b: need }) + " · " : ""}${t("до {d}", { d: fmtDate(b.defenseDeadline) })} · ${t("осталось {t}", { t: left(b.defenseDeadline, now) })}` };
      return { who: "admin", mine: false, text: t("Ход администратора: проверяет записи ответа"), detail: defender || !teamId ? t("принято {a} из {b}", { a: b.defenseApproved, b: need }) : "" };
    case "REPELLED": return { who: "over", mine: false, text: t("Город устоял"), detail: `${b.defenseBid != null ? t("ответ: {n}", { n: verses(b.defenseBid) }) + " · " : ""}${day(b.resolvedAt)}` };
    case "WON": return { who: "over", mine: false, text: t("Город взят"), detail: `${t("ответ не сдан в срок")} · ${day(b.resolvedAt)}` };
    case "EXPIRED": return { who: "over", mine: false, text: t("Вызов сгорел"), detail: `${t("не отправлен на проверку за срок")} · ${day(b.resolvedAt)}` };
    default: return { who: "over", mine: false, text: t("Испытание отменено"), detail: day(b.resolvedAt) };
  }
}

/** Этапы и их состояние по полям испытания. */
export function trialSteps(b: BattleDto, teamId: string | null): Step[] {
  const s = b.status, need = b.defenseNeed ?? b.bid;
  const defenderSees = !teamId || teamId === b.defender.id || b.myAlliance?.status === "ACTIVE";
  const afterAttack = s === "DEFENSE" || s === "REPELLED" || s === "WON";
  const cancelled = s === "CANCELLED";
  const call: Step = { key: "call", icon: "call", cap: t("Вызов"), sub: s === "QUEUED" ? t("в очереди") : day(b.startedAt ?? b.declaredAt), state: s === "QUEUED" ? "current" : "done" };
  const learn: Step = s === "QUEUED" ? { key: "learn", icon: "learn", cap: t("Стихи"), sub: verses(b.bid), state: "future" }
    : s === "ATTACK" && !b.attackDoneAt ? { key: "learn", icon: "learn", cap: t("Стихи"), sub: t("{a} из {b}", { a: b.attackSum, b: b.bid }), state: "current" }
    : s === "EXPIRED" ? { key: "learn", icon: "learn", cap: t("Стихи"), sub: t("не сданы"), state: "failed" }
    : cancelled && !b.attackDoneAt ? { key: "learn", icon: "learn", cap: t("Стихи"), sub: "", state: "future" }
    : { key: "learn", icon: "learn", cap: t("Стихи"), sub: day(b.attackDoneAt), state: "done" };
  const check1: Step = s === "ATTACK" && b.attackDoneAt ? { key: "check1", icon: "check", cap: t("Проверка"), sub: t("{a} из {b}", { a: b.attackApproved, b: b.bid }), state: "current" }
    : afterAttack ? { key: "check1", icon: "check", cap: t("Проверка"), sub: day(b.attackApprovedAt), state: "done" }
    : { key: "check1", icon: "check", cap: t("Проверка"), sub: "", state: "future" };
  const answer: Step = s === "DEFENSE" && !b.defenseDoneAt ? { key: "answer", icon: "answer", cap: t("Ответ"), sub: defenderSees ? t("{a} из {b}", { a: b.defenseSum, b: need }) : verses(need), state: "current" }
    : s === "DEFENSE" || s === "REPELLED" ? { key: "answer", icon: "answer", cap: t("Ответ"), sub: day(b.defenseDoneAt), state: "done" }
    : s === "WON" ? { key: "answer", icon: "answer", cap: t("Ответ"), sub: t("не сдан"), state: "failed" }
    : { key: "answer", icon: "answer", cap: t("Ответ"), sub: "", state: "future" };
  const check2: Step = s === "DEFENSE" && b.defenseDoneAt ? { key: "check2", icon: "check", cap: t("Проверка"), sub: defenderSees ? t("{a} из {b}", { a: b.defenseApproved, b: need }) : "", state: "current" }
    : s === "REPELLED" ? { key: "check2", icon: "check", cap: t("Проверка"), sub: day(b.resolvedAt), state: "done" }
    : { key: "check2", icon: "check", cap: t("Проверка"), sub: "", state: "future" };
  const result: Step = s === "REPELLED" ? { key: "result", icon: "held", cap: t("Устоял"), sub: day(b.resolvedAt), state: "done" }
    : s === "WON" ? { key: "result", icon: "taken", cap: t("Взят"), sub: day(b.resolvedAt), state: "done" }
    : s === "EXPIRED" ? { key: "result", icon: "burnt", cap: t("Сгорел"), sub: day(b.resolvedAt), state: "failed" }
    : cancelled ? { key: "result", icon: "burnt", cap: t("Отменено"), sub: day(b.resolvedAt), state: "failed" }
    : { key: "result", icon: "held", cap: t("Итог"), sub: "", state: "future" };
  return [call, learn, check1, answer, check2, result];
}

export function TrialFlow({ b, teamId, now = Date.now(), compact = false }: { b: BattleDto; /** Команда зрителя; у администратора null. */ teamId: string | null; now?: number; /** Только медальоны в одну строку: для списка испытаний. */ compact?: boolean }) {
  const steps = trialSteps(b, teamId);
  const turn = trialTurn(b, teamId, now);
  const whoIcon = turn.who === "admin" ? "check" : turn.who === "attacker" ? "wave" : turn.who === "defender" ? "shield" : turn.who === "over" ? "flag" : "clock";
  return (
    <div className={"trial-flow" + (compact ? " compact" : "") + (live(b) ? "" : " over")}>
      {!compact && (
        <div className={"trial-turn " + turn.who + (turn.mine ? " mine" : "")}>
          <Icon name={whoIcon} />
          <div className="grow"><b>{turn.text}</b>{turn.detail && <span>{turn.detail}</span>}</div>
        </div>
      )}
      <ol className="trial-steps" aria-label={t("Этапы испытания")}>
        {steps.map((s) => (
          <li key={s.key} className={"step " + s.state} title={`${s.cap}${s.sub ? ` · ${s.sub}` : ""}`}>
            <span className="medal">
              <img src={`/img/trial/${s.icon}.webp`} alt="" decoding="async" />
              {s.state === "done" && <i className="mark ok"><Icon name="check" /></i>}
              {s.state === "failed" && <i className="mark bad"><Icon name="x" /></i>}
            </span>
            {!compact && <span className="cap">{s.cap}</span>}
            {!compact && s.sub && <span className="sub">{s.sub}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
