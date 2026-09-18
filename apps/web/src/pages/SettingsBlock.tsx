import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";

export interface RulesDto { minBid: number; attackDays: number; burnPenalty: number; minAnswerSeconds: number; passageDays: number; lockWeeks: number; fatigueAfterDays: number; fatigueStepDays: number; fatigueStep: number; deedReturnDays: number; roleChangeDays: number; pauseSteps: number[]; siegeDays: number; siegeDeedPoints: number; roleCooldownDays: number; chronicleWeekday: number; chronicleHourUtc: number; adminDigest: "instant" | "3h" | "daily" }
interface GameDto { id: string; name: string; status: string; teamCount: number; mapSeed: number | null; settings: { nodeCount?: number; equidistantStarts?: boolean; maxStartDistanceDiff?: number; includeGenealogies?: boolean; donationMin?: number | null; donationCurrency?: string; rules?: RulesDto } }
/** Продвинутые настройки: правила, которые раньше были зашиты в код (решение владельца 18.09). Подписи — по-русски, значения — числа. */
const RULE_FIELDS: Array<{ key: keyof RulesDto; label: () => string; min: number; max: number }> = [
  { key: "minBid", label: () => t("Минимальная ставка вызова, стихов"), min: 1, max: 1000 },
  { key: "attackDays", label: () => t("Срок вызова, дней"), min: 1, max: 60 },
  { key: "burnPenalty", label: () => t("Штраф за сгоревший вызов, стихов"), min: 0, max: 100 },
  { key: "minAnswerSeconds", label: () => t("Минимальное время ответа, секунд"), min: 10, max: 86400 },
  { key: "passageDays", label: () => t("Срок ответа на запрос прохода, дней"), min: 1, max: 30 },
  { key: "lockWeeks", label: () => t("Закрепление после отбитого максимума, недель"), min: 0, max: 52 },
  { key: "fatigueAfterDays", label: () => t("Усталость города: дней без дел до убыли"), min: 1, max: 365 },
  { key: "fatigueStepDays", label: () => t("Усталость: убыль раз во сколько дней"), min: 1, max: 365 },
  { key: "fatigueStep", label: () => t("Усталость: на сколько стихов за шаг"), min: 0, max: 100 },
  { key: "deedReturnDays", label: () => t("Взятое дело возвращается в список через, дней"), min: 1, max: 365 },
  { key: "roleChangeDays", label: () => t("Смена ролей не чаще раза в, дней"), min: 0, max: 365 },
  { key: "roleCooldownDays", label: () => t("Ход разведчика и пророка раз в, дней"), min: 1, max: 60 },
  { key: "chronicleWeekday", label: () => t("Летопись недели: день (0 — воскресенье … 6 — суббота)"), min: 0, max: 6 },
  { key: "chronicleHourUtc", label: () => t("Летопись недели: час по UTC"), min: 0, max: 23 },
  { key: "siegeDays", label: () => t("Осада делами, дней"), min: 1, max: 60 },
  { key: "siegeDeedPoints", label: () => t("Баллов за дело при осаде"), min: 0, max: 100 },
];

/** Настройки игры: форма всегда открыта, поля сгруппированы. В игре можно менять только пожертвование. */
export function SettingsBlock({ game, onSaved }: { game: GameDto; onSaved: () => void }) {
  const { notify } = useUi();
  const [name, setName] = useState(game.name);
  const [teamCount, setTeamCount] = useState(game.teamCount);
  const [nodeCount, setNodeCount] = useState(game.settings.nodeCount ?? 250);
  const [equidistant, setEquidistant] = useState(game.settings.equidistantStarts ?? false);
  const [maxDiff, setMaxDiff] = useState(game.settings.maxStartDistanceDiff ?? 3);
  const [genealogies, setGenealogies] = useState(game.settings.includeGenealogies ?? false);
  const [donationMin, setDonationMin] = useState<number | "">(game.settings.donationMin ?? "");
  const [currency, setCurrency] = useState(game.settings.donationCurrency ?? "");
  const [rules, setRules] = useState<Record<string, number | string>>(() => { const r = (game.settings.rules ?? {}) as Partial<RulesDto>; const out: Record<string, number | string> = {}; for (const f of RULE_FIELDS) out[f.key] = (r[f.key] as number | undefined) ?? 0; out.pauseSteps = (r.pauseSteps ?? [20, 60, 300, 900, 3600]).join(", "); out.adminDigest = r.adminDigest ?? "instant"; return out; });
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = game.status === "DRAFT";
  if (game.status === "FINISHED") return null;

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const donation = { donationMin: donationMin === "" ? null : Number(donationMin), donationCurrency: currency };
    const rulesOut: Record<string, unknown> = {};
    for (const f of RULE_FIELDS) rulesOut[f.key] = Number(rules[f.key]);
    rulesOut.pauseSteps = String(rules.pauseSteps).split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    rulesOut.adminDigest = rules.adminDigest || "instant";
    try {
      await api(`/api/games/${game.id}`, { method: "PATCH", body: JSON.stringify({ ...(draft ? { name, teamCount } : {}), settings: draft ? { nodeCount, equidistantStarts: equidistant, maxStartDistanceDiff: maxDiff, includeGenealogies: genealogies, ...donation, rules: rulesOut } : { ...donation, rules: rulesOut } }) });
      notify(t("Настройки сохранены"));
      if (draft && game.mapSeed && (teamCount !== game.teamCount || nodeCount !== (game.settings.nodeCount ?? 250))) notify(t("Карту нужно сгенерировать заново"), "info");
      onSaved();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="card-head"><h2><span className="ico"><Icon name="settings" /></span>{t("Настройки")}</h2></div>
      <form onSubmit={save}>
        {draft && (
          <>
            <div className="settings-group">
              <h3>{t("Игра")}</h3>
              <label htmlFor="s-name">{t("Название")}</label>
              <input id="s-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
              <label htmlFor="s-teams">{t("Команд")}</label>
              <input id="s-teams" type="number" min={2} max={12} value={teamCount} onChange={(e) => setTeamCount(Number(e.target.value))} />
            </div>
            <div className="settings-group">
              <h3>{t("Карта и старты")}</h3>
              <label htmlFor="s-nodes">{t("Перекрёстков на карте")}</label>
              <input id="s-nodes" type="number" min={200} max={600} step={10} value={nodeCount} onChange={(e) => setNodeCount(Number(e.target.value))} />
              <p className="hint">{t("После изменения числа команд или перекрёстков карту нужно сгенерировать заново.")}</p>
              <label className="check mt-3"><input type="checkbox" checked={equidistant} onChange={(e) => setEquidistant(e.target.checked)} />{t("Выровнять расстояние от стартов до первого города")}</label>
              {equidistant && (
                <div className="sub">
                  <label htmlFor="s-diff">{t("Допустимая разница, ходов")}</label>
                  <input id="s-diff" type="number" min={0} max={6} value={maxDiff} onChange={(e) => setMaxDiff(Number(e.target.value))} />
                </div>
              )}
            </div>
            <div className="settings-group">
              <h3>{t("Испытания")}</h3>
              <label className="check"><input type="checkbox" checked={genealogies} onChange={(e) => setGenealogies(e.target.checked)} />{t("Отрывки могут содержать родословия и списки имён")}</label>
            </div>
          </>
        )}
        <div className="settings-group">
          <h3>{t("Пожертвование вместо дела")}</h3>
          <div className="money">
            <div>
              <label htmlFor="s-don">{t("Минимум")}</label>
              <input id="s-don" type="number" min={0} value={donationMin} onChange={(e) => setDonationMin(e.target.value === "" ? "" : Number(e.target.value))} />
            </div>
            <div>
              <label htmlFor="s-cur">{t("Валюта")}</label>
              <input id="s-cur" className="cur" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} placeholder="₽" />
            </div>
          </div>
          <p className="hint">{draft ? t("Пусто — пожертвование выключено.") : t("После старта можно менять только пожертвование и правила: карта и команды зафиксированы.")}</p>
        </div>
        <details className="settings-group disclose" open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
          <summary><h3>{t("Продвинутые настройки")}</h3></summary>
          <p className="hint">{t("Правила игры в числах. Значения по умолчанию подобраны для сезона; меняйте, только если понимаете, зачем. Идущие испытания доигрываются по прежним срокам.")}</p>
          {RULE_FIELDS.map((f) => (
            <div key={f.key} className="rule-row">
              <label htmlFor={"rule-" + f.key}>{f.label()}</label>
              <input id={"rule-" + f.key} type="number" min={f.min} max={f.max} value={rules[f.key]} onChange={(e) => setRules({ ...rules, [f.key]: e.target.value === "" ? "" : Number(e.target.value) })} />
            </div>
          ))}
          <div className="rule-row">
            <label htmlFor="rule-pauseSteps">{t("Растущая пауза после неверного ответа, секунды по ступеням")}</label>
            <input id="rule-pauseSteps" value={rules.pauseSteps} onChange={(e) => setRules({ ...rules, pauseSteps: e.target.value })} />
          </div>
          <div className="rule-row">
            <label htmlFor="rule-adminDigest">{t("Письма администраторам о сдачах")}</label>
            <select id="rule-adminDigest" value={String(rules.adminDigest)} onChange={(e) => setRules({ ...rules, adminDigest: e.target.value })}>
              <option value="instant">{t("сразу о каждой")}</option>
              <option value="3h">{t("одним письмом раз в 3 часа")}</option>
              <option value="daily">{t("одним письмом раз в день")}</option>
            </select>
          </div>
        </details>
        {error && <p className="error">{error}</p>}
        <div className="actions"><button type="submit" disabled={busy}>{t("Сохранить")}</button></div>
      </form>
    </div>
  );
}
