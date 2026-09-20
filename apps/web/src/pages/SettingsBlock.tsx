import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Help } from "../components/Help";
import { Stepper } from "../components/Stepper";

export interface RulesDto { minBid: number; attackDays: number; burnPenalty: number; minAnswerSeconds: number; passageDays: number; lockWeeks: number; fatigueAfterDays: number; fatigueStepDays: number; fatigueStep: number; deedReturnDays: number; roleChangeDays: number; pauseSteps: number[]; siegeDays: number; siegeDeedPoints: number; roleCooldownDays: number; chronicleWeekday: number; chronicleHourUtc: number; adminDigest: "instant" | "3h" | "daily" }
interface GameDto { id: string; name: string; status: string; teamCount: number; mapSeed: number | null; settings: { nodeCount?: number; cityGap?: number; equidistantStarts?: boolean; maxStartDistanceDiff?: number; includeGenealogies?: boolean; donationMin?: number | null; donationCurrency?: string; rules?: RulesDto } }
type NumKey = Exclude<keyof RulesDto, "pauseSteps" | "adminDigest">;
/** Продвинутые настройки: правила, которые раньше были зашиты в код (решение владельца 18.09). Подписи короткие, единицы — суффиксом; поля сгруппированы. */
const RULE_FIELDS: Record<NumKey, { label: () => string; min: number; max: number; step?: number }> = {
  minBid: { label: () => t("Минимальная ставка · стихов"), min: 1, max: 1000 },
  attackDays: { label: () => t("Срок вызова · дней"), min: 1, max: 60 },
  burnPenalty: { label: () => t("Штраф за сгоревший вызов · стихов"), min: 0, max: 100 },
  minAnswerSeconds: { label: () => t("Минимум на ответ · секунд"), min: 10, max: 86400 },
  lockWeeks: { label: () => t("Закрепление города · недель"), min: 0, max: 52 },
  fatigueAfterDays: { label: () => t("Усталость: дней без дел"), min: 1, max: 365 },
  fatigueStepDays: { label: () => t("Усталость: шаг · дней"), min: 1, max: 365 },
  fatigueStep: { label: () => t("Усталость: убыль · стихов"), min: 0, max: 100 },
  deedReturnDays: { label: () => t("Возврат взятого дела · дней"), min: 1, max: 365 },
  roleChangeDays: { label: () => t("Смена ролей · раз в дней"), min: 0, max: 365 },
  roleCooldownDays: { label: () => t("Разведчик и пророк · раз в дней"), min: 1, max: 60 },
  passageDays: { label: () => t("Ответ на запрос прохода · дней"), min: 1, max: 30 },
  siegeDays: { label: () => t("Осада делами · дней"), min: 1, max: 60 },
  siegeDeedPoints: { label: () => t("Баллов за дело в осаде"), min: 0, max: 100 },
  chronicleWeekday: { label: () => t("Летопись: день недели"), min: 0, max: 6 },
  chronicleHourUtc: { label: () => t("Летопись: час (UTC)"), min: 0, max: 23 },
};
const NUM_KEYS = Object.keys(RULE_FIELDS) as NumKey[];
const RULE_GROUPS: Array<{ title: () => string; keys: Array<keyof RulesDto> }> = [
  { title: () => t("Испытания"), keys: ["minBid", "attackDays", "burnPenalty", "minAnswerSeconds", "lockWeeks", "pauseSteps"] },
  { title: () => t("Города"), keys: ["fatigueAfterDays", "fatigueStepDays", "fatigueStep"] },
  { title: () => t("Дела и роли"), keys: ["deedReturnDays", "roleChangeDays", "roleCooldownDays"] },
  { title: () => t("Проходы"), keys: ["passageDays"] },
  { title: () => t("Осада"), keys: ["siegeDays", "siegeDeedPoints"] },
  { title: () => t("Летопись и письма"), keys: ["chronicleWeekday", "chronicleHourUtc", "adminDigest"] },
];
/** День летописи выбирается по названию; значение по-прежнему 0–6 (0 — воскресенье), как ждёт сервер. */
const weekdays = () => [t("воскресенье"), t("понедельник"), t("вторник"), t("среда"), t("четверг"), t("пятница"), t("суббота")];

/** Настройки игры: форма всегда открыта, поля сгруппированы. В игре можно менять только пожертвование. */
export function SettingsBlock({ game, onSaved }: { game: GameDto; onSaved: () => void }) {
  const { notify } = useUi();
  const [name, setName] = useState(game.name);
  const [teamCount, setTeamCount] = useState(game.teamCount);
  const [nodeCount, setNodeCount] = useState(game.settings.nodeCount ?? 250);
  const [cityGap, setCityGap] = useState(game.settings.cityGap ?? 2);
  const [equidistant, setEquidistant] = useState(game.settings.equidistantStarts ?? false);
  const [maxDiff, setMaxDiff] = useState(game.settings.maxStartDistanceDiff ?? 3);
  const [genealogies, setGenealogies] = useState(game.settings.includeGenealogies ?? false);
  const [donationMin, setDonationMin] = useState<number | "">(game.settings.donationMin ?? "");
  const [currency, setCurrency] = useState(game.settings.donationCurrency ?? "");
  const [rules, setRules] = useState<Record<string, number | string>>(() => { const r = (game.settings.rules ?? {}) as Partial<RulesDto>; const out: Record<string, number | string> = {}; for (const k of NUM_KEYS) out[k] = (r[k] as number | undefined) ?? 0; out.pauseSteps = (r.pauseSteps ?? [20, 60, 300, 900, 3600]).join(", "); out.adminDigest = r.adminDigest ?? "instant"; return out; });
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = game.status === "DRAFT";
  if (game.status === "FINISHED") return null;
  // Предупреждение о перегенерации — только когда число команд или перекрёстков действительно изменено.
  const mapChanged = draft && Boolean(game.mapSeed) && (teamCount !== game.teamCount || nodeCount !== (game.settings.nodeCount ?? 250) || cityGap !== (game.settings.cityGap ?? 2));

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const donation = { donationMin: donationMin === "" ? null : Number(donationMin), donationCurrency: currency };
    const rulesOut: Record<string, unknown> = {};
    for (const k of NUM_KEYS) rulesOut[k] = Number(rules[k]);
    rulesOut.pauseSteps = String(rules.pauseSteps).split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    rulesOut.adminDigest = rules.adminDigest || "instant";
    try {
      await api(`/api/games/${game.id}`, { method: "PATCH", body: JSON.stringify({ ...(draft ? { name, teamCount } : {}), settings: draft ? { nodeCount, cityGap, equidistantStarts: equidistant, maxStartDistanceDiff: maxDiff, includeGenealogies: genealogies, ...donation, rules: rulesOut } : { ...donation, rules: rulesOut } }) });
      notify(t("Настройки сохранены"));
      if (mapChanged) notify(t("Карту нужно сгенерировать заново"), "info");
      onSaved();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  const setRule = (key: string, value: number | string) => setRules({ ...rules, [key]: value });
  /** Строка правила: число, список пауз, выбор дня недели или режима писем. */
  const ruleRow = (key: keyof RulesDto) => {
    const id = "rule-" + key;
    if (key === "pauseSteps") return (
      <div key={key} className="rule-row">
        <label htmlFor={id}>{t("Паузы после ошибок · секунды через запятую")}</label>
        <input id={id} value={rules.pauseSteps} onChange={(e) => setRule("pauseSteps", e.target.value)} />
      </div>
    );
    if (key === "adminDigest") return (
      <div key={key} className="rule-row">
        <label htmlFor={id}>{t("Письма о сдачах")}</label>
        <select id={id} value={String(rules.adminDigest)} onChange={(e) => setRule("adminDigest", e.target.value)}>
          <option value="instant">{t("сразу о каждой")}</option>
          <option value="3h">{t("одним письмом раз в 3 часа")}</option>
          <option value="daily">{t("одним письмом раз в день")}</option>
        </select>
      </div>
    );
    const f = RULE_FIELDS[key];
    if (key === "chronicleWeekday") return (
      <div key={key} className="rule-row">
        <label htmlFor={id}>{f.label()}</label>
        <select id={id} value={String(rules.chronicleWeekday)} onChange={(e) => setRule("chronicleWeekday", Number(e.target.value))}>
          {weekdays().map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </div>
    );
    return (
      <div key={key} className="rule-row">
        <label htmlFor={id}>{f.label()}</label>
        <Stepper id={id} value={rules[key] === "" ? "" : Number(rules[key])} min={f.min} max={f.max} step={f.step ?? 1} onChange={(v) => setRule(key, v)} />
      </div>
    );
  };

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
              <Stepper id="s-teams" value={teamCount} min={2} max={12} onChange={(v) => setTeamCount(v === "" ? 2 : v)} />
            </div>
            <div className="settings-group">
              <h3>{t("Карта и старты")}</h3>
              <label htmlFor="s-nodes">{t("Перекрёстков на карте")}</label>
              <Stepper id="s-nodes" value={nodeCount} min={200} max={600} step={10} onChange={(v) => setNodeCount(v === "" ? 250 : v)} />
              <label htmlFor="s-gap">{t("Расстояние между городами · сторон")}<Help>{t("Сколько сторон гексов отделяет соседние города, не меньше. По умолчанию 2 (в среднем чуть больше двух). При 3 или 4 путь между городами длиннее, а карта больше: перекрёстков в (N/2)² раз больше, чем задано выше.")}</Help></label>
              <Stepper id="s-gap" value={cityGap} min={2} max={4} onChange={(v) => setCityGap(v === "" ? 2 : v)} />
              {mapChanged && <p className="note warn"><Icon name="alert" /><span>{t("После изменения числа команд, перекрёстков или расстояния между городами карту нужно сгенерировать заново.")}</span></p>}
              <label className="check mt-3"><input type="checkbox" checked={equidistant} onChange={(e) => setEquidistant(e.target.checked)} />{t("Выровнять расстояние от стартов до первого города")}</label>
              {equidistant && (
                <div className="sub">
                  <label htmlFor="s-diff">{t("Допустимая разница, ходов")}</label>
                  <Stepper id="s-diff" value={maxDiff} min={0} max={6} onChange={(v) => setMaxDiff(v === "" ? 3 : v)} />
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
              <Stepper id="s-don" value={donationMin} min={0} step={50} onChange={setDonationMin} />
            </div>
            <div>
              <label htmlFor="s-cur">{t("Валюта")}</label>
              <input id="s-cur" className="cur" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} placeholder="₽" />
            </div>
          </div>
          <p className="hint">{draft ? t("Пусто — пожертвование выключено.") : t("В игре меняются только пожертвование и правила.")}</p>
        </div>
        <details className="settings-group disclose" open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
          <summary><h3>{t("Продвинутые настройки")}</h3></summary>
          <p className="hint">{t("Числа правил. По умолчанию подобраны для сезона — меняйте, если понимаете, зачем. Идущие испытания доигрываются по старым срокам.")}</p>
          {RULE_GROUPS.map((g) => (
            <div key={g.title()} className="rule-group-block">
              <h4 className="rule-group">{g.title()}</h4>
              {g.keys.map(ruleRow)}
            </div>
          ))}
        </details>
        {error && <p className="error">{error}</p>}
        <div className="actions"><button type="submit" disabled={busy}>{t("Сохранить")}</button></div>
      </form>
    </div>
  );
}
