import { useState, type ReactNode } from "react";
import { api, ApiError, type StormSlot } from "../lib/api";
import { stormState } from "@lotw/domain";
import { useUi } from "../lib/ui";
import { getLocale, t } from "../lib/i18n";
import { plural } from "../lib/format";
import { Icon } from "../components/Icon";
import { Help } from "../components/Help";
import { Stepper } from "../components/Stepper";
import { Sheet } from "../components/Sheet";

export interface RulesDto { timeZone: string; minBid: number; attackDays: number; burnPenalty: number; minAnswerSeconds: number; passageDays: number; lockWeeks: number; fatigueAfterDays: number; fatigueStepDays: number; fatigueStep: number; deedReturnDays: number; maxDeedsPerDay: number; roleChangeDays: number; pauseSteps: number[]; siegeDays: number; siegeDeedPoints: number; roleCooldownDays: number; keySolversPct: number; keyTasksPct: number; chronicleWeekday: number; chronicleHourUtc: number; adminDigest: "instant" | "3h" | "daily"; /** Штормы (решение владельца 24.10): интервалы недели по поясу игры. */ storms?: StormSlot[] }
interface GameDto { id: string; name: string; status: string; teamCount: number; mapSeed: number | null; settings: { nodeCount?: number; cityGap?: number; equidistantStarts?: boolean; maxStartDistanceDiff?: number; includeGenealogies?: boolean; donationCurrency?: string; rules?: RulesDto } }
/** Правила, зашитые глобально и убранные из настроек (решение владельца 03.10): минимальная ставка, штраф за сгоревший вызов, закрепление города, усталость, паузы после ошибок. Сервер хранит их значения по умолчанию. */
type FixedKey = "minBid" | "burnPenalty" | "lockWeeks" | "fatigueAfterDays" | "fatigueStepDays" | "fatigueStep" | "pauseSteps" | "storms" | "chronicleWeekday" | "chronicleHourUtc";
type NumKey = Exclude<keyof RulesDto, FixedKey | "adminDigest" | "timeZone">;
type RuleKey = Exclude<keyof RulesDto, FixedKey>;
/** Числа правил (решение владельца 18.09): короткая подпись строки, подпись поля с единицей, границы. */
const RULE_FIELDS: Record<NumKey, { short: () => string; label: () => string; min: number; max: number; step?: number }> = {
  attackDays: { short: () => t("Срок вызова"), label: () => t("Срок вызова · дней"), min: 1, max: 60 },
  minAnswerSeconds: { short: () => t("Минимум на ответ"), label: () => t("Минимум на ответ · секунд"), min: 10, max: 86400 },
  deedReturnDays: { short: () => t("Возврат взятого дела"), label: () => t("Возврат взятого дела · дней"), min: 1, max: 365 },
  maxDeedsPerDay: { short: () => t("Дел в сутки на участника"), label: () => t("Дел в сутки на участника · 0 = без ограничения"), min: 0, max: 50 },
  roleChangeDays: { short: () => t("Смена ролей"), label: () => t("Смена ролей · раз в дней"), min: 0, max: 365 },
  roleCooldownDays: { short: () => t("Разведчик и пророк"), label: () => t("Разведчик и пророк · раз в дней"), min: 1, max: 60 },
  keySolversPct: { short: () => t("Ключ города · решивших"), label: () => t("Ключ города · решивших долю не меньше, % команды"), min: 0, max: 100 },
  keyTasksPct: { short: () => t("Доля заданий города"), label: () => t("Доля заданий города на участника, %"), min: 1, max: 100 },
  passageDays: { short: () => t("Ответ на запрос прохода"), label: () => t("Ответ на запрос прохода · дней"), min: 1, max: 30 },
  siegeDays: { short: () => t("Осада делами"), label: () => t("Осада делами · дней"), min: 1, max: 60 },
  siegeDeedPoints: { short: () => t("Баллов за дело в осаде"), label: () => t("Баллов за дело в осаде"), min: 0, max: 100 },
};
const RULE_GROUPS: Array<{ title: () => string; keys: RuleKey[]; /** Строка «Родословия» (только до старта) живёт в группе испытаний. */ genealogies?: boolean }> = [
  { title: () => t("Испытания"), keys: ["attackDays", "timeZone", "minAnswerSeconds"], genealogies: true },
  { title: () => t("Дела и роли"), keys: ["deedReturnDays", "maxDeedsPerDay", "roleChangeDays", "roleCooldownDays"] },
  { title: () => t("Города"), keys: ["keySolversPct", "keyTasksPct"] },
  { title: () => t("Проходы"), keys: ["passageDays"] },
  { title: () => t("Осада"), keys: ["siegeDays", "siegeDeedPoints"] },
  { title: () => t("Письма"), keys: ["adminDigest"] },
];
/** Пояснение к каждому правилу: зачем, когда применяется, на что влияет (решение владельца 02.10). */
const RULE_HELP: Record<RuleKey, () => string> = {
  attackDays: () => t("Сколько дней с начала вызова у претендентов, чтобы отправить записи на проверку. Время, пока записи лежат у администратора, не считается. Не успели — вызов сгорает и ставится штраф."),
  timeZone: () => t("Часовой пояс, по которому считаются времена суток игры: утро 7:00–9:00, день 9:00–18:00, вечер 18:00–22:00, ночь 22:00–7:00. Ночью города спят и ничего делать нельзя, только смотреть карту; вызов на город отправляют на проверку только утром. Записывается именем из базы часовых поясов, например Asia/Tashkent или Europe/Moscow. Можно менять в идущей игре."),
  minAnswerSeconds: () => t("Техническая защита хранителей. Их срок на ответ равен времени атаки претендентов, но не меньше этого числа секунд, даже если претенденты справились мгновенно."),
  deedReturnDays: () => t("Взятое и не сданное дело через столько дней само возвращается в общий список команды, а взявшему приходит уведомление."),
  maxDeedsPerDay: () => t("Сколько дел один участник может взять за сутки. Считаются дела, взятые за последние 24 часа с момента взятия. Сверх лимита взять дело нельзя, лист дела об этом скажет. 0 — без ограничения. Можно менять в идущей игре."),
  roleChangeDays: () => t("Уже выданную игровую роль капитан может сменить не чаще раза в столько дней. Участникам без роли роль выдаётся сразу. 0 — без ограничения."),
  roleCooldownDays: () => t("Раз во сколько дней разведчик может разведать точку на краю тумана, а пророк — открыть подсказку к заданию. Считается на команду."),
  keySolversPct: () => t("Ключ конверта можно ввести, только когда не меньше такой доли состава команды решили каждый свою долю заданий города (следующая настройка). 0 — без ограничения."),
  keyTasksPct: () => t("Задания города решает каждый сам, и после того, как команда открыла знак. Участник считается решившим город, когда сам решил не меньше такой доли его заданий."),
  passageDays: () => t("Сколько дней у владельца города на ответ на запрос прохода. Нет ответа в срок — считается отказом."),
  siegeDays: () => t("Сколько дней длится осада делами города с максимальным уровнем защиты. За это время обе команды набирают баллы одобренными делами."),
  siegeDeedPoints: () => t("Сколько баллов в осаде даёт одобренное дело, если у самого дела своя цена не задана. Цену отдельного дела задают во вкладке «Дела»."),
  adminDigest: () => t("Как администраторы узнают о сдачах: письмом сразу о каждой, одним письмом раз в 3 часа или одним письмом раз в день. Уведомления в приложении приходят всегда сразу."),
};
const DIGEST = (): Record<string, string> => ({ instant: t("сразу о каждой"), "3h": t("одним письмом раз в 3 часа"), daily: t("одним письмом раз в день") });
const weekdays = () => [t("воскресенье"), t("понедельник"), t("вторник"), t("среда"), t("четверг"), t("пятница"), t("суббота")];
const weekdaysShort = () => [t("вс"), t("пн"), t("вт"), t("ср"), t("чт"), t("пт"), t("сб")];

/** Срок в днях словами: дробные дни (ускоренная тестовая партия) — числом с «дн.». */
function days(n: number): string { return Number.isInteger(n) ? plural(n, [t("день"), t("дня"), t("дней")]) : `${n} ${t("дн.")}`; }
const UNLIMITED = () => t("без ограничения");
/** Значение правила в строке режима чтения. */
function ruleValue(key: RuleKey, v: number | string): string {
  const n = Number(v);
  switch (key) {
    case "timeZone": return String(v);
    case "adminDigest": return DIGEST()[String(v)] ?? String(v);
    case "attackDays": case "deedReturnDays": case "passageDays": case "siegeDays": return days(n);
    case "minAnswerSeconds": return plural(n, [t("секунда"), t("секунды"), t("секунд")]);
    case "maxDeedsPerDay": return n === 0 ? UNLIMITED() : `${plural(n, [t("дело"), t("дела"), t("дел")])} ${t("в сутки")}`;
    case "roleChangeDays": return n === 0 ? UNLIMITED() : t("раз в {d}", { d: days(n) });
    case "roleCooldownDays": return t("раз в {d}", { d: days(n) });
    case "keySolversPct": return n === 0 ? UNLIMITED() : `${n} %`;
    case "keyTasksPct": return `${n} %`;
    case "siegeDeedPoints": return plural(n, [t("балл"), t("балла"), t("баллов")]);
  }
}
const toMin = (hm: string) => { const [h, m] = hm.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const fromMin = (m: number) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
/** Длительность интервала в часах (конец раньше начала — через полночь); 0 считается сутками без получаса. */
const hoursOf = (s: StormSlot) => { const d = (toMin(s.to) - toMin(s.from) + 1440) % 1440; return (d === 0 ? 1410 : d) / 60; };
const TIME_RE = /^\d{1,2}:\d{2}$/;
const slotLine = (s: StormSlot) => `${weekdaysShort()[s.weekday] ?? ""} ${s.from} – ${s.to}`;
function validTz(tz: string): boolean { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }

type Draft = Record<string, unknown>;
/** Открытая настройка: ключ строки или интервал шторма (индекс или новый). */
type Editing = { key: string } | { storm: number | null };

/**
 * Настройки игры (решение владельца 25.10): список строк «подпись — значение» по группам, строка открывает лист с одним
 * полем и «?» у заголовка; «Готово» сохраняет сразу и погашена, пока значение не изменилось. Общей кнопки «Сохранить» нет.
 * Шторм: интервалы как расписание, лист с днями-кнопками, началом и длительностью (конец считается сам, в том числе через полночь).
 */
export function SettingsBlock({ game, onSaved }: { game: GameDto; onSaved: () => void }) {
  const { notify } = useUi();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [initial, setInitial] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draftGame = game.status === "DRAFT";
  if (game.status === "FINISHED") return null;
  const s = game.settings, rules = (s.rules ?? {}) as Partial<RulesDto>;
  const storms = rules.storms ?? [], tz = rules.timeZone || "Asia/Tashkent";
  const rule = (k: RuleKey): number | string => k === "timeZone" ? tz : k === "adminDigest" ? (rules.adminDigest ?? "instant") : (rules[k] as number | undefined) ?? 0;
  // Ближайшая смена по сохранённым настройкам и поясу игры: сразу видно ошибку в дне или времени.
  const stormNow = (() => {
    if (!storms.length) return null;
    const st = stormState(storms, tz, new Date());
    if (st.nextChangeMs === null) return null;
    let when = "";
    try { when = new Intl.DateTimeFormat(getLocale() === "en" ? "en-GB" : "ru-RU", { timeZone: tz, weekday: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(Date.now() + st.nextChangeMs)); } catch { when = ""; }
    return { active: st.active, when };
  })();

  const open = (e: Editing, d: Draft) => { setDraft(d); setInitial(JSON.stringify(d)); setError(null); setEditing(e); };
  const close = () => { if (!busy) setEditing(null); };
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = (editing !== null && "storm" in editing && editing.storm === null) || JSON.stringify(draft) !== initial;

  async function save(body: Record<string, unknown>, mapChanged = false) {
    setBusy(true); setError(null);
    try {
      await api(`/api/games/${game.id}`, { method: "PATCH", body: JSON.stringify(body) });
      notify(t("Сохранено"));
      if (mapChanged) notify(t("Карту нужно сгенерировать заново"), "info");
      setEditing(null);
      onSaved();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("Ошибка сети")); }
    finally { setBusy(false); }
  }

  /** Строка настройки: открывается листом. Настройки «только до старта» в идущей игре не показываются (решение владельца 25.10). */
  const row = (key: string, label: string, value: ReactNode, d: Draft) =>
    <button key={key} type="button" className="set-row" onClick={() => open({ key }, d)}><span className="k">{label}</span><span className="v">{value}</span><Icon name="chevron-down" className="chev right" /></button>;
  const num = (v: unknown) => (v === "" ? "" : Number(v));
  const mapNow = { teamCount: game.teamCount, nodeCount: s.nodeCount ?? 250, cityGap: s.cityGap ?? 2 };

  /** Лист открытой строки: заголовок, «?», поле; что отправить и можно ли. */
  function sheet(): { title: string; help?: string; body: ReactNode; valid: boolean; onSave: () => void } | null {
    if (!editing || !("key" in editing)) return null;
    const k = editing.key;
    const warnMap = draftGame && Boolean(game.mapSeed);
    if (k === "name") return { title: t("Название"), help: t("Имя партии: его видят участники в заголовке игры, в письмах и уведомлениях. Меняется только до старта."), valid: String(draft.name).trim().length >= 2,
      body: <input id="s-name" value={String(draft.name)} onChange={(e) => set("name", e.target.value)} minLength={2} maxLength={80} autoFocus />, onSave: () => void save({ name: String(draft.name).trim() }) };
    if (k === "teamCount") return { title: t("Команд"), help: t("Сколько команд будет в партии: столько стартов разместит генератор карты. После изменения карту нужно сгенерировать заново. Только до старта."), valid: draft.teamCount !== "",
      body: <>
        <Stepper id="s-teams" value={num(draft.teamCount)} min={2} max={12} onChange={(v) => set("teamCount", v)} />
        {warnMap && num(draft.teamCount) !== mapNow.teamCount && <p className="note warn"><Icon name="alert" /><span>{t("После изменения числа команд, перекрёстков или расстояния между городами карту нужно сгенерировать заново.")}</span></p>}
      </>, onSave: () => void save({ teamCount: Number(draft.teamCount) }, warnMap && Number(draft.teamCount) !== mapNow.teamCount) };
    if (k === "nodeCount") return { title: t("Перекрёстков на карте"), help: t("Размер карты: число перекрёстков на двух островах. Больше перекрёстков — больше дел и дольше партия. После изменения карту нужно сгенерировать заново. Только до старта."), valid: draft.nodeCount !== "",
      body: <>
        <Stepper id="s-nodes" value={num(draft.nodeCount)} min={200} max={600} step={10} onChange={(v) => set("nodeCount", v)} />
        {warnMap && num(draft.nodeCount) !== mapNow.nodeCount && <p className="note warn"><Icon name="alert" /><span>{t("После изменения числа команд, перекрёстков или расстояния между городами карту нужно сгенерировать заново.")}</span></p>}
      </>, onSave: () => void save({ settings: { nodeCount: Number(draft.nodeCount) } }, warnMap && Number(draft.nodeCount) !== mapNow.nodeCount) };
    if (k === "cityGap") return { title: t("Расстояние между городами"), help: t("Сколько сторон гексов отделяет соседние города, не меньше. По умолчанию 2 (в среднем чуть больше двух). При 3 или 4 путь между городами длиннее, а карта больше: перекрёстков в (N/2)² раз больше, чем задано выше."), valid: draft.cityGap !== "",
      body: <>
        <label htmlFor="s-gap">{t("Расстояние между городами · сторон")}</label>
        <Stepper id="s-gap" value={num(draft.cityGap)} min={2} max={4} onChange={(v) => set("cityGap", v)} />
        {warnMap && num(draft.cityGap) !== mapNow.cityGap && <p className="note warn"><Icon name="alert" /><span>{t("После изменения числа команд, перекрёстков или расстояния между городами карту нужно сгенерировать заново.")}</span></p>}
      </>, onSave: () => void save({ settings: { cityGap: Number(draft.cityGap) } }, warnMap && Number(draft.cityGap) !== mapNow.cityGap) };
    if (k === "starts") return { title: t("Старты"), help: t("При генерации карты старты подбираются так, чтобы у всех команд путь до ближайшего города был одинаковой длины, с точностью до допустимой разницы. Иначе старты ставятся без этого условия."), valid: !draft.equidistant || draft.maxDiff !== "",
      body: <>
        <label className="check"><input type="checkbox" checked={Boolean(draft.equidistant)} onChange={(e) => set("equidistant", e.target.checked)} />{t("Выровнять расстояние от стартов до первого города")}</label>
        {Boolean(draft.equidistant) && (
          <div className="sub">
            <label htmlFor="s-diff">{t("Допустимая разница, ходов")}<Help popup>{t("На сколько сторон может отличаться путь до первого города у разных команд при выравнивании стартов. 0 — ровно одинаково; генератору может не хватить вариантов.")}</Help></label>
            <Stepper id="s-diff" value={num(draft.maxDiff)} min={0} max={6} onChange={(v) => set("maxDiff", v)} />
          </div>
        )}
      </>, onSave: () => void save({ settings: { equidistantStarts: Boolean(draft.equidistant), maxStartDistanceDiff: Number(draft.maxDiff === "" ? 3 : draft.maxDiff) } }) };
    if (k === "genealogies") return { title: t("Родословия"), help: t("Случайный отрывок для испытания выбирается из всей книги города. Если выключено, главы с родословиями и длинными списками имён пропускаются, чтобы не учить перечни. Только до старта."), valid: true,
      body: <label className="check"><input type="checkbox" checked={Boolean(draft.genealogies)} onChange={(e) => set("genealogies", e.target.checked)} />{t("Отрывки могут содержать родословия и списки имён")}</label>,
      onSave: () => void save({ settings: { includeGenealogies: Boolean(draft.genealogies) } }) };
    if (k === "currency") return { title: t("Валюта"), help: `${t("Подпись к суммам пожертвований в листе дела и в проверке, например «сум» или «₽». Сама минимальная сумма задаётся у каждого дела во вкладке «Дела». Можно менять в идущей игре.")} ${t("Минимальная сумма у каждого дела своя — задаётся во вкладке «Дела». У дела без суммы замены пожертвованием нет.")}`, valid: true,
      body: <input id="s-cur" className="cur" value={String(draft.currency)} onChange={(e) => set("currency", e.target.value)} maxLength={10} placeholder="₽" autoFocus />,
      onSave: () => void save({ settings: { donationCurrency: String(draft.currency).trim() } }) };
    if (k === "timeZone") return { title: t("Часовой пояс игры"), help: RULE_HELP.timeZone(), valid: validTz(String(draft.timeZone).trim()),
      body: <input id="rule-timeZone" value={String(draft.timeZone)} onChange={(e) => set("timeZone", e.target.value)} placeholder="Asia/Tashkent" autoFocus />,
      onSave: () => void save({ settings: { rules: { timeZone: String(draft.timeZone).trim() } } }) };
    if (k === "adminDigest") return { title: t("Письма о сдачах"), help: RULE_HELP.adminDigest(), valid: true,
      body: <select id="rule-adminDigest" value={String(draft.adminDigest)} onChange={(e) => set("adminDigest", e.target.value)}>{Object.entries(DIGEST()).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>,
      onSave: () => void save({ settings: { rules: { adminDigest: String(draft.adminDigest) } } }) };
    if (k in RULE_FIELDS) {
      const f = RULE_FIELDS[k as NumKey];
      return { title: f.short(), help: RULE_HELP[k as NumKey](), valid: draft.value !== "",
        body: <><label htmlFor={"rule-" + k}>{f.label()}</label><Stepper id={"rule-" + k} value={num(draft.value)} min={f.min} max={f.max} step={f.step ?? 1} onChange={(v) => set("value", v)} /></>,
        onSave: () => void save({ settings: { rules: { [k]: Number(draft.value) } } }) };
    }
    return null;
  }

  /** Лист интервала шторма: день кнопками, начало, длительность; итог считается сам. */
  function stormSheet(): { title: string; body: ReactNode; valid: boolean; onSave: () => void; onRemove?: () => void } | null {
    if (!editing || !("storm" in editing)) return null;
    const idx = editing.storm;
    const wd = Number(draft.weekday), from = String(draft.from), hours = draft.hours === "" ? NaN : Number(draft.hours);
    const valid = TIME_RE.test(from) && hours >= 0.5 && hours <= 23.5;
    const to = valid ? fromMin(toMin(from) + Math.round(hours * 60)) : "";
    const next: StormSlot = { weekday: wd, from, to };
    const list = idx === null ? [...storms, next] : storms.map((x, i) => (i === idx ? next : x));
    return {
      title: idx === null ? t("Новый интервал") : t("Интервал шторма"), valid,
      body: <>
        <div className="chips day-chips" role="radiogroup" aria-label={t("День недели")}>
          {weekdaysShort().map((d, w) => <button key={w} type="button" role="radio" aria-checked={wd === w} className={"chip-btn" + (wd === w ? " on" : "")} title={weekdays()[w]} onClick={() => set("weekday", w)}>{d}</button>)}
        </div>
        <div className="storm-fields">
          <div><label htmlFor="storm-from">{t("Начало")}</label><input id="storm-from" type="time" value={from} onChange={(e) => set("from", e.target.value)} /></div>
          <div><label htmlFor="storm-hours">{t("Длится · часов")}</label><Stepper id="storm-hours" value={draft.hours === "" ? "" : Number(draft.hours)} min={0.5} max={23.5} step={0.5} onChange={(v) => set("hours", v)} /></div>
        </div>
        {valid && <p className="hint">{slotLine(next)}</p>}
      </>,
      onSave: () => void save({ settings: { rules: { storms: list } } }),
      onRemove: idx === null ? undefined : () => void save({ settings: { rules: { storms: storms.filter((_, i) => i !== idx) } } }),
    };
  }

  const sh = sheet(), ss = stormSheet();
  const digestLabel = DIGEST()[String(rule("adminDigest"))] ?? "";
  return (
    <div className="card settings">
      {draftGame && (
        <>
          <div className="settings-group">
            <h3>{t("Игра")}</h3>
            {row("name", t("Название"), game.name, { name: game.name })}
            {row("teamCount", t("Команд"), game.teamCount, { teamCount: game.teamCount })}
          </div>
          <div className="settings-group">
            <h3>{t("Карта и старты")}</h3>
            {row("nodeCount", t("Перекрёстков на карте"), s.nodeCount ?? 250, { nodeCount: s.nodeCount ?? 250 })}
            {row("cityGap", t("Расстояние между городами"), plural(s.cityGap ?? 2, [t("сторона"), t("стороны"), t("сторон")]), { cityGap: s.cityGap ?? 2 })}
            {row("starts", t("Старты"), s.equidistantStarts ? `${t("выровнены")} · ±${s.maxStartDistanceDiff ?? 3}` : t("как получится"), { equidistant: s.equidistantStarts ?? false, maxDiff: s.maxStartDistanceDiff ?? 3 })}
          </div>
        </>
      )}
      <div className="settings-group">
        <h3>{t("Пожертвование вместо дела")}</h3>
        {row("currency", t("Валюта"), s.donationCurrency || "—", { currency: s.donationCurrency ?? "" })}
      </div>
      <div className="settings-group">
        <h3>{t("Шторм")}<Help popup>{t("Пока идёт шторм, участники видят только карту с бурей: кнопок нет, дела не берутся, города не открываются; сервер действия не принимает. Администраторов шторм не касается. Время по поясу игры; конец раньше начала — интервал через полночь. Можно менять в идущей игре.")}</Help>
          {storms.length < 21 && <button type="button" className="ghost icon sm add" onClick={() => open({ storm: null }, { weekday: 0, from: "10:00", hours: 2 })} aria-label={t("Добавить интервал")} title={t("Добавить интервал")}><Icon name="plus" /></button>}
        </h3>
        {storms.map((x, i) => (
          <button key={i} type="button" className="set-row" onClick={() => open({ storm: i }, { weekday: x.weekday, from: x.from, hours: hoursOf(x) })}><span className="k strong">{slotLine(x)}</span><Icon name="chevron-down" className="chev right" /></button>
        ))}
        {storms.length === 0 && <p className="hint">{t("Интервалов нет: штормов не будет.")}</p>}
        {stormNow && <p className="hint">{stormNow.active ? t("По сохранённым настройкам шторм идёт сейчас, до: {when}", { when: stormNow.when }) : t("По сохранённым настройкам ближайший шторм: {when}", { when: stormNow.when })}</p>}
      </div>
      {RULE_GROUPS.map((g) => (
        <div key={g.title()} className="settings-group">
          <h3>{g.title()}</h3>
          {g.genealogies && draftGame && row("genealogies", t("Родословия"), s.includeGenealogies ? t("да") : t("нет"), { genealogies: s.includeGenealogies ?? false })}
          {g.keys.map((k) => row(k, k === "timeZone" ? t("Часовой пояс игры") : k === "adminDigest" ? t("Письма о сдачах") : RULE_FIELDS[k as NumKey].short(), k === "adminDigest" ? digestLabel : ruleValue(k, rule(k)), k === "timeZone" ? { timeZone: tz } : k === "adminDigest" ? { adminDigest: rule("adminDigest") } : { value: rule(k) }))}
        </div>
      ))}
      {sh && (
        <Sheet size="sm" onClose={close} head={<div className="sheet-title"><h2>{sh.title}</h2>{sh.help && <Help popup>{sh.help}</Help>}</div>}
          foot={<><button type="button" className="ghost" onClick={close} disabled={busy}>{t("Отмена")}</button><button type="button" onClick={sh.onSave} disabled={!dirty || !sh.valid || busy}>{t("Готово")}</button></>}>
          <div className="set-sheet">{sh.body}{error && <p className="error">{error}</p>}</div>
        </Sheet>
      )}
      {ss && (
        <Sheet size="sm" onClose={close} title={ss.title}
          foot={<>{ss.onRemove && <button type="button" className="secondary danger" onClick={ss.onRemove} disabled={busy}><Icon name="trash" />{t("Убрать")}</button>}<button type="button" className="ghost" onClick={close} disabled={busy}>{t("Отмена")}</button><button type="button" onClick={ss.onSave} disabled={!dirty || !ss.valid || busy}>{t("Готово")}</button></>}>
          <div className="set-sheet">{ss.body}{error && <p className="error">{error}</p>}</div>
        </Sheet>
      )}
    </div>
  );
}
