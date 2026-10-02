import { useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { Icon } from "../components/Icon";
import { Help } from "../components/Help";
import { Stepper } from "../components/Stepper";

export interface RulesDto { attackSubmitFrom: number; attackSubmitTo: number; timeZone: string; minBid: number; attackDays: number; burnPenalty: number; minAnswerSeconds: number; passageDays: number; lockWeeks: number; fatigueAfterDays: number; fatigueStepDays: number; fatigueStep: number; deedReturnDays: number; maxDeedsPerDay: number; roleChangeDays: number; pauseSteps: number[]; siegeDays: number; siegeDeedPoints: number; roleCooldownDays: number; chronicleWeekday: number; chronicleHourUtc: number; adminDigest: "instant" | "3h" | "daily" }
interface GameDto { id: string; name: string; status: string; teamCount: number; mapSeed: number | null; settings: { nodeCount?: number; cityGap?: number; equidistantStarts?: boolean; maxStartDistanceDiff?: number; includeGenealogies?: boolean; donationCurrency?: string; rules?: RulesDto } }
/** Правила, зашитые глобально и убранные из настроек (решение владельца 03.10): минимальная ставка, штраф за сгоревший вызов, закрепление города, усталость, паузы после ошибок. Сервер хранит их значения по умолчанию. */
type FixedKey = "minBid" | "burnPenalty" | "lockWeeks" | "fatigueAfterDays" | "fatigueStepDays" | "fatigueStep" | "pauseSteps";
type NumKey = Exclude<keyof RulesDto, FixedKey | "adminDigest" | "timeZone">;
/** Продвинутые настройки: правила, которые раньше были зашиты в код (решение владельца 18.09). Подписи короткие, единицы — суффиксом; поля сгруппированы. */
const RULE_FIELDS: Record<NumKey, { label: () => string; min: number; max: number; step?: number }> = {
  attackDays: { label: () => t("Срок вызова · дней"), min: 1, max: 60 },
  attackSubmitFrom: { label: () => t("Отправка вызова: с · час"), min: 0, max: 24 },
  attackSubmitTo: { label: () => t("Отправка вызова: до · час"), min: 0, max: 24 },
  minAnswerSeconds: { label: () => t("Минимум на ответ · секунд"), min: 10, max: 86400 },
  deedReturnDays: { label: () => t("Возврат взятого дела · дней"), min: 1, max: 365 },
  maxDeedsPerDay: { label: () => t("Дел в сутки на участника · 0 = без ограничения"), min: 0, max: 50 },
  roleChangeDays: { label: () => t("Смена ролей · раз в дней"), min: 0, max: 365 },
  roleCooldownDays: { label: () => t("Разведчик и пророк · раз в дней"), min: 1, max: 60 },
  passageDays: { label: () => t("Ответ на запрос прохода · дней"), min: 1, max: 30 },
  siegeDays: { label: () => t("Осада делами · дней"), min: 1, max: 60 },
  siegeDeedPoints: { label: () => t("Баллов за дело в осаде"), min: 0, max: 100 },
  chronicleWeekday: { label: () => t("Летопись: день недели"), min: 0, max: 6 },
  chronicleHourUtc: { label: () => t("Летопись: час (UTC)"), min: 0, max: 23 },
};
const NUM_KEYS = Object.keys(RULE_FIELDS) as NumKey[];
const RULE_GROUPS: Array<{ title: () => string; keys: Array<Exclude<keyof RulesDto, FixedKey>> }> = [
  { title: () => t("Испытания"), keys: ["attackDays", "attackSubmitFrom", "attackSubmitTo", "timeZone", "minAnswerSeconds"] },
  { title: () => t("Дела и роли"), keys: ["deedReturnDays", "maxDeedsPerDay", "roleChangeDays", "roleCooldownDays"] },
  { title: () => t("Проходы"), keys: ["passageDays"] },
  { title: () => t("Осада"), keys: ["siegeDays", "siegeDeedPoints"] },
  { title: () => t("Летопись и письма"), keys: ["chronicleWeekday", "chronicleHourUtc", "adminDigest"] },
];
/** Пояснение к каждому правилу: зачем, когда применяется, на что влияет (решение владельца 02.10). */
const RULE_HELP: Record<Exclude<keyof RulesDto, FixedKey>, () => string> = {
  attackDays: () => t("Сколько дней с начала вызова у претендентов, чтобы отправить записи на проверку. Время, пока записи лежат у администратора, не считается. Не успели — вызов сгорает и ставится штраф."),
  attackSubmitFrom: () => t("Час местного времени, с которого капитан претендентов может нажать «Отправить вызов на проверку». Раньше кнопка погашена, но стихи отмечать можно. На ответ хранителей не действует."),
  attackSubmitTo: () => t("Час местного времени, до которого можно отправить вызов на проверку. Если «с» и «до» равны, ограничения нет. Срок вызова окно не продлевает."),
  timeZone: () => t("Часовой пояс, по которому считается окно отправки вызова. Записывается именем из базы часовых поясов, например Asia/Tashkent или Europe/Moscow."),
  minAnswerSeconds: () => t("Техническая защита хранителей. Их срок на ответ равен времени атаки претендентов, но не меньше этого числа секунд, даже если претенденты справились мгновенно."),
  deedReturnDays: () => t("Взятое и не сданное дело через столько дней само возвращается в общий список команды, а взявшему приходит уведомление."),
  maxDeedsPerDay: () => t("Сколько дел один участник может взять за сутки. Считаются дела, взятые за последние 24 часа с момента взятия. Сверх лимита взять дело нельзя, лист дела об этом скажет. 0 — без ограничения. Можно менять в идущей игре."),
  roleChangeDays: () => t("Уже выданную игровую роль капитан может сменить не чаще раза в столько дней. Участникам без роли роль выдаётся сразу. 0 — без ограничения."),
  roleCooldownDays: () => t("Раз во сколько дней разведчик может разведать точку на краю тумана, а пророк — открыть подсказку к заданию. Считается на команду."),
  passageDays: () => t("Сколько дней у владельца города на ответ на запрос прохода. Нет ответа в срок — считается отказом."),
  siegeDays: () => t("Сколько дней длится осада делами города с максимальным уровнем защиты. За это время обе команды набирают баллы одобренными делами."),
  siegeDeedPoints: () => t("Сколько баллов в осаде даёт одобренное дело, если у самого дела своя цена не задана. Цену отдельного дела задают во вкладке «Дела»."),
  chronicleWeekday: () => t("День недели, когда всем участникам уходит летопись недели: дела, города, испытания без ставок."),
  chronicleHourUtc: () => t("Час по UTC, после которого в выбранный день уходит летопись недели. Для Ташкента местное время на 5 часов больше."),
  adminDigest: () => t("Как администраторы узнают о сдачах: письмом сразу о каждой, одним письмом раз в 3 часа или одним письмом раз в день. Уведомления в приложении приходят всегда сразу."),
};
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
  const [currency, setCurrency] = useState(game.settings.donationCurrency ?? "");
  const [rules, setRules] = useState<Record<string, number | string>>(() => { const r = (game.settings.rules ?? {}) as Partial<RulesDto>; const out: Record<string, number | string> = {}; for (const k of NUM_KEYS) out[k] = (r[k] as number | undefined) ?? 0; out.adminDigest = r.adminDigest ?? "instant"; out.timeZone = r.timeZone ?? "Asia/Tashkent"; return out; });
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = game.status === "DRAFT";
  if (game.status === "FINISHED") return null;
  // Предупреждение о перегенерации — только когда число команд или перекрёстков действительно изменено.
  const mapChanged = draft && Boolean(game.mapSeed) && (teamCount !== game.teamCount || nodeCount !== (game.settings.nodeCount ?? 250) || cityGap !== (game.settings.cityGap ?? 2));

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const donation = { donationCurrency: currency };
    const rulesOut: Record<string, unknown> = {};
    for (const k of NUM_KEYS) rulesOut[k] = Number(rules[k]);
    rulesOut.adminDigest = rules.adminDigest || "instant";
    rulesOut.timeZone = String(rules.timeZone).trim() || "Asia/Tashkent";
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
  const ruleRow = (key: Exclude<keyof RulesDto, FixedKey>) => {
    const id = "rule-" + key;
    if (key === "timeZone") return (
      <div key={key} className="rule-row">
        <label htmlFor={id}>{t("Часовой пояс игры")}<Help popup>{RULE_HELP.timeZone()}</Help></label>
        <input id={id} value={String(rules.timeZone)} onChange={(e) => setRule("timeZone", e.target.value)} placeholder="Asia/Tashkent" />
      </div>
    );
    if (key === "adminDigest") return (
      <div key={key} className="rule-row">
        <label htmlFor={id}>{t("Письма о сдачах")}<Help popup>{RULE_HELP.adminDigest()}</Help></label>
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
        <label htmlFor={id}>{f.label()}<Help popup>{RULE_HELP[key]()}</Help></label>
        <select id={id} value={String(rules.chronicleWeekday)} onChange={(e) => setRule("chronicleWeekday", Number(e.target.value))}>
          {weekdays().map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      </div>
    );
    return (
      <div key={key} className="rule-row">
        <label htmlFor={id}>{f.label()}<Help popup>{RULE_HELP[key]()}</Help></label>
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
              <label htmlFor="s-name">{t("Название")}<Help popup>{t("Имя партии: его видят участники в заголовке игры, в письмах и уведомлениях. Меняется только до старта.")}</Help></label>
              <input id="s-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
              <label htmlFor="s-teams">{t("Команд")}<Help popup>{t("Сколько команд будет в партии: столько стартов разместит генератор карты. После изменения карту нужно сгенерировать заново. Только до старта.")}</Help></label>
              <Stepper id="s-teams" value={teamCount} min={2} max={12} onChange={(v) => setTeamCount(v === "" ? 2 : v)} />
            </div>
            <div className="settings-group">
              <h3>{t("Карта и старты")}</h3>
              <label htmlFor="s-nodes">{t("Перекрёстков на карте")}<Help popup>{t("Размер карты: число перекрёстков на двух островах. Больше перекрёстков — больше дел и дольше партия. После изменения карту нужно сгенерировать заново. Только до старта.")}</Help></label>
              <Stepper id="s-nodes" value={nodeCount} min={200} max={600} step={10} onChange={(v) => setNodeCount(v === "" ? 250 : v)} />
              <label htmlFor="s-gap">{t("Расстояние между городами · сторон")}<Help popup>{t("Сколько сторон гексов отделяет соседние города, не меньше. По умолчанию 2 (в среднем чуть больше двух). При 3 или 4 путь между городами длиннее, а карта больше: перекрёстков в (N/2)² раз больше, чем задано выше.")}</Help></label>
              <Stepper id="s-gap" value={cityGap} min={2} max={4} onChange={(v) => setCityGap(v === "" ? 2 : v)} />
              {mapChanged && <p className="note warn"><Icon name="alert" /><span>{t("После изменения числа команд, перекрёстков или расстояния между городами карту нужно сгенерировать заново.")}</span></p>}
              <label className="check mt-3"><input type="checkbox" checked={equidistant} onChange={(e) => setEquidistant(e.target.checked)} />{t("Выровнять расстояние от стартов до первого города")}<Help popup>{t("При генерации карты старты подбираются так, чтобы у всех команд путь до ближайшего города был одинаковой длины, с точностью до допустимой разницы. Иначе старты ставятся без этого условия.")}</Help></label>
              {equidistant && (
                <div className="sub">
                  <label htmlFor="s-diff">{t("Допустимая разница, ходов")}<Help popup>{t("На сколько сторон может отличаться путь до первого города у разных команд при выравнивании стартов. 0 — ровно одинаково; генератору может не хватить вариантов.")}</Help></label>
                  <Stepper id="s-diff" value={maxDiff} min={0} max={6} onChange={(v) => setMaxDiff(v === "" ? 3 : v)} />
                </div>
              )}
            </div>
            <div className="settings-group">
              <h3>{t("Испытания")}</h3>
              <label className="check"><input type="checkbox" checked={genealogies} onChange={(e) => setGenealogies(e.target.checked)} />{t("Отрывки могут содержать родословия и списки имён")}<Help popup>{t("Случайный отрывок для испытания выбирается из всей книги города. Если выключено, главы с родословиями и длинными списками имён пропускаются, чтобы не учить перечни. Только до старта.")}</Help></label>
            </div>
          </>
        )}
        <div className="settings-group">
          <h3>{t("Пожертвование вместо дела")}</h3>
          <div className="money">
            <div>
              <label htmlFor="s-cur">{t("Валюта")}<Help popup>{t("Подпись к суммам пожертвований в листе дела и в проверке, например «сум» или «₽». Сама минимальная сумма задаётся у каждого дела во вкладке «Дела». Можно менять в идущей игре.")}</Help></label>
              <input id="s-cur" className="cur" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={10} placeholder="₽" />
            </div>
          </div>
          <p className="hint">{t("Минимальная сумма у каждого дела своя — задаётся во вкладке «Дела». У дела без суммы замены пожертвованием нет.")}{!draft && <> {t("В игре меняются только пожертвование и правила.")}</>}</p>
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
