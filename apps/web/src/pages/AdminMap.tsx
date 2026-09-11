import { useMemo, useState } from "react";
import { BOOKS } from "@lotw/domain";
import { HEX_SIZE, TERRAIN_COLOR, fieldBounds, nodePos, TEAM_COLORS } from "../lib/hexmap";
import { HexTiles, IMG } from "./MapLayers";
import { useViewport } from "../lib/useViewport";
import { api, type AdminCityDto, type MapEdgeDto, type MapHexDto, type MapNodeDto } from "../lib/api";
import { useEffect } from "react";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";

const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
export interface CityProgress { teamId: string; nodeKey: string; orderSolved: boolean; done: number; capturedAt: string | null; isCapital: boolean }
export interface BattleProgress { id: string; nodeKey: string; status: string; attackerId: string; defenderId: string; bid: number }
export interface TeamProgress { id: string; name: string; color: string; startNodeKey: string | null; revealed: string[]; revealedAt?: string[]; traversed: Array<{ fromKey: string; toKey: string; at?: string }> }

/** Карта админа: вся карта без тумана, города на перекрёстках, пройденные стороны цветами команд (половинками, если прошли двое). */
export function AdminMap({ gameId, hexes, nodes, edges, progress, cities, battles, version }: { gameId: string; hexes: MapHexDto[]; nodes: MapNodeDto[]; edges: MapEdgeDto[]; progress: TeamProgress[] | null; cities: CityProgress[] | null; battles: BattleProgress[] | null; version: number }) {
  const size = HEX_SIZE;
  const bounds = useMemo(() => (hexes.length ? fieldBounds(hexes, size) : null), [hexes, size]);
  const vp = useViewport(bounds);
  const [selected, setSelected] = useState<MapNodeDto | null>(null);
  const positions = useMemo(() => new Map(nodes.map((n) => [n.key, nodePos(n.key, size)])), [nodes, size]);
  const traversedBy = useMemo(() => {
    const m = new Map<string, TeamProgress[]>();
    for (const t of progress ?? []) for (const e of t.traversed) { const k = [e.fromKey, e.toKey].sort().join("|"); m.set(k, [...(m.get(k) ?? []), t]); }
    return m;
  }, [progress]);
  const teamById = useMemo(() => new Map((progress ?? []).map((tm) => [tm.id, tm])), [progress]);
  const ownerOf = useMemo(() => {
    const m = new Map<string, TeamProgress>();
    for (const c of cities ?? []) if (c.capturedAt) { const t = teamById.get(c.teamId); if (t) m.set(c.nodeKey, t); }
    return m;
  }, [cities, teamById]);
  const battleAt = useMemo(() => new Map((battles ?? []).map((b) => [b.nodeKey, b])), [battles]);
  const revealedBy = useMemo(() => {
    const m = new Map<string, TeamProgress[]>();
    for (const t of progress ?? []) for (const k of t.revealed) m.set(k, [...(m.get(k) ?? []), t]);
    return m;
  }, [progress]);
  if (!bounds) return null;

  return (
    <>
      <div style={{ position: "relative" }}>
        <div ref={vp.ref} {...vp.handlers} className="mapwrap" style={{ height: "min(70vh, 640px)", minHeight: 360, touchAction: "none", cursor: "grab", userSelect: "none", overflow: "hidden" }}>
          <svg width="100%" height="100%" style={{ display: "block" }}>
            <g transform={`translate(${vp.view.tx},${vp.view.ty}) scale(${vp.view.k})`}>
              <HexTiles hexes={hexes} size={size} clipId="hexclip-admin" />
              {nodes.map((n) => {
                const p = positions.get(n.key)!;
                const CITY = size * 1.15, START = size * 1.35;
                if (n.kind === "START") return <image key={"s" + n.key} href={IMG.start(n.teamIndex ?? 0)} x={p.x - START / 2} y={p.y - START * 0.58} width={START} height={START} />;
                if (n.kind === "CITY") {
                  const owner = ownerOf.get(n.key);
                  return (
                    <g key={"c" + n.key}>
                      {owner && <circle cx={p.x} cy={p.y - CITY * 0.1} r={CITY * 0.62} fill={owner.color} fillOpacity={0.35} stroke={owner.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                      <image href={IMG.city(n.cityType)} x={p.x - CITY / 2} y={p.y - CITY * 0.6} width={CITY} height={CITY} />
                    </g>
                  );
                }
                return null;
              })}
              {edges.map((e) => {
                const a = positions.get(e.aKey), b = positions.get(e.bKey);
                if (!a || !b) return null;
                const teams = traversedBy.get([e.aKey, e.bKey].sort().join("|")) ?? [];
                if (teams.length === 0) return <line key={e.aKey + e.bKey} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(31,27,22,.25)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
                if (teams.length === 1) return <line key={e.aKey + e.bKey} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={teams[0]!.color} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                return <g key={e.aKey + e.bKey}><line x1={a.x} y1={a.y} x2={mx} y2={my} stroke={teams[0]!.color} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" /><line x1={mx} y1={my} x2={b.x} y2={b.y} stroke={teams[1]!.color} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" /></g>;
              })}
            </g>
            <g>
              {nodes.map((n) => {
                const raw = positions.get(n.key)!;
                const kk = vp.view.k;
                const p = { x: vp.view.tx + raw.x * kk, y: vp.view.ty + raw.y * kk };
                const book = n.bookCode ? BOOK_BY_CODE.get(n.bookCode) : undefined;
                const seen = revealedBy.get(n.key) ?? [];
                const sel = selected?.key === n.key;
                const showLabels = kk >= 1.4, showDots = kk >= 0.8;
                if (n.kind === "START") { const t = progress?.find((x) => x.startNodeKey === n.key); const color = t?.color ?? TEAM_COLORS[(n.teamIndex ?? 0) % TEAM_COLORS.length]!; return <circle key={n.key} cx={p.x} cy={p.y} r={6} fill={color} stroke="#fff" strokeWidth={2} onClick={() => setSelected(n)} style={{ cursor: "pointer" }} />; }
                if (n.kind === "CITY") return (
                  <g key={n.key} transform={`translate(${p.x},${p.y})`} onClick={() => setSelected(sel ? null : n)} style={{ cursor: "pointer" }}>
                    <circle r={size * 0.6 * kk} fill="transparent" />
                    {battleAt.has(n.key) && <text x={size * 0.6 * kk} y={-size * 0.7 * kk} fontSize={Math.max(14, 22 * Math.min(1.4, kk))} textAnchor="middle" fill="#B3402F" stroke="#fff" strokeWidth={3} paintOrder="stroke" style={{ pointerEvents: "none" }}>🌊</text>}
                    {showLabels ? (
                      <g transform={`translate(0,${size * 1.15 * kk * 0.48})`}>
                        <rect x={-48} y={-10} width={96} height={20} rx={4} fill={sel ? "#C7742A" : "#F3EAD3"} stroke="#1F1B16" strokeWidth={1} />
                        <text textAnchor="middle" dy="0.35em" fontSize={11} fontWeight={700} fill={sel ? "#fff" : "#1F1B16"}>{book?.order}. {book?.nameRu}</text>
                      </g>
                    ) : <g><circle r={8} fill={sel ? "#C7742A" : "#fff"} stroke="#1F1B16" strokeWidth={1} /><text textAnchor="middle" dy="0.35em" fontSize={9} fontWeight={700} fill={sel ? "#fff" : "#1F1B16"}>{book?.order}</text></g>}
                    {seen.map((tm, i) => <circle key={tm.id} cx={14 - i * 9} cy={-14} r={4.5} fill={tm.color} stroke="#fff" strokeWidth={1} />)}
                  </g>
                );
                if (!showDots) return null;
                return <g key={n.key} transform={`translate(${p.x},${p.y})`}><circle r={3} fill="rgba(31,27,22,.4)" />{seen.map((tm, i) => <circle key={tm.id} cx={8 - i * 7} cy={-8} r={3.5} fill={tm.color} stroke="#fff" strokeWidth={0.8} />)}</g>;
              })}
            </g>
          </svg>
        </div>
        <div style={{ position: "absolute", right: 10, top: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <button className="secondary sm" style={{ width: 40, padding: 0 }} onClick={vp.fit} aria-label={t("Вся карта")}>⤢</button>
        </div>
      </div>
      <div className="legend">
        {Object.entries(TERRAIN_COLOR).map(([k, c]) => <span key={k} style={{ ["--c" as string]: c }}>{t(({ desert: "пустыня", hills: "холмы", meadow: "луг", mountains: "горы", water: "вода", oasis: "оазис" } as Record<string, string>)[k] ?? k)}</span>)}
        <span style={{ ["--c" as string]: "#fff" }}>{t("город на перекрёстке (номер книги)")}</span>
        {progress?.map((tm) => <span key={tm.id} style={{ ["--c" as string]: tm.color }}>{tm.name}</span>)}
      </div>
      {selected?.kind === "CITY" && battleAt.get(selected.key) && (() => { const b = battleAt.get(selected.key)!; const at = teamById.get(b.attackerId), df = teamById.get(b.defenderId); return <p className="note bad" style={{ marginTop: ".6rem" }}>🌊 {t("Испытание: «{a}» бросает вызов «{d}», ставка {n} ст.", { a: at?.name ?? "?", d: df?.name ?? "?", n: b.bid })} · {b.status === "QUEUED" ? t("в очереди") : b.status === "ATTACK" ? t("идёт вызов") : t("идёт ответ")}. {t("Записи — в блоке «Испытания» выше.")}</p>; })()}
      {selected?.kind === "CITY" && <AdminCityPanel gameId={gameId} node={selected} version={version} revealedTeams={revealedBy.get(selected.key) ?? []} onClose={() => setSelected(null)} />}
      {selected && selected.kind !== "CITY" && (
        <div className="note ok" style={{ marginTop: ".6rem" }}>
          {selected.kind === "START" ? t("Старт команды {n}", { n: (selected.teamIndex ?? 0) + 1 }) : t("Развилка")} · {t("перекрёсток {key}", { key: selected.key })}
          {(revealedBy.get(selected.key) ?? []).length > 0 && ` · ${t("открыт: {names}", { names: (revealedBy.get(selected.key) ?? []).map((tm) => tm.name).join(", ") })}`}
          <RevealButtons gameId={gameId} nodeKey={selected.key} teams={progress ?? []} revealedBy={revealedBy.get(selected.key) ?? []} />
        </div>
      )}
    </>
  );
}

/** Панель города для админа: ключ конверта, прогресс команд, районы и задания с ответами. */
function AdminCityPanel({ gameId, node, version, revealedTeams, onClose }: { gameId: string; node: MapNodeDto; version: number; revealedTeams: Array<{ id: string }>; onClose: () => void }) {
  const [city, setCity] = useState<AdminCityDto | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  useEffect(() => { let alive = true; api<AdminCityDto>(`/api/games/${gameId}/cities/${encodeURIComponent(node.key)}`).then((c) => { if (alive) setCity(c); }).catch(() => { if (alive) setCity(null); }); return () => { alive = false; }; }, [gameId, node.key, version]);
  const book = BOOK_BY_CODE.get(node.bookCode ?? "");
  const total = city?.content?.tasks.length ?? 0;
  return (
    <div className="admin-city">
      <div className="row between">
        <div><strong>{t("Город {name}", { name: book?.nameRu ?? "" })}</strong> <span className="muted">· {t("перекрёсток {key}", { key: node.key })} · {node.cityType}</span></div>
        <button className="ghost sm" onClick={onClose} aria-label={t("Закрыть")}>✕</button>
      </div>
      {!city && <p className="muted">{t("Загрузка…")}</p>}
      {city && (
        <>
          <p style={{ margin: ".3rem 0" }}>{t("Ключ конверта:")} {city.node.cityKey ? <code className="key">{city.node.cityKey}</code> : <span className="muted">{t("появится после старта игры")}</span>}
            {city.node.cityCode && <> · {t("шифр для семьи:")} <strong style={{ letterSpacing: ".08em" }}>{city.node.cityCode}</strong></>}</p>
          {!city.content && <p className="note warn">{t("Задания для этой книги ещё готовятся: команды пока не могут взять этот город.")}</p>}
          <RevealButtons gameId={gameId} nodeKey={node.key} teams={city.teams} revealedBy={revealedTeams} />
          <AssignButtons gameId={gameId} nodeKey={node.key} teams={city.teams} />
          <ul className="list">
            {city.teams.map((tm) => (
              <li key={tm.id}>
                <div className="main"><span className="avatar" style={{ background: tm.color, color: "#fff" }}>{tm.name.slice(0, 1)}</span> <strong>{tm.name}</strong></div>
                <span className="muted">
                  {tm.capturedAt ? <span className="badge accent">{t("город перешёл")}{tm.isCapital ? t(" · столица") : ""}</span>
                    : tm.orderSolved ? t("районы открыты · заданий {a}/{b}", { a: tm.doneTasks.length, b: total })
                    : tm.orderAttempts > 0 ? t("собирает порядок · попыток {n}", { n: tm.orderAttempts }) : t("не начинала")}
                </span>
              </li>
            ))}
          </ul>
          {city.content && (
            <>
              <button className="secondary sm" onClick={() => setShowAnswers((v) => !v)}>{showAnswers ? t("Скрыть районы и ответы") : t("Районы и задания с ответами ({n})", { n: total })}</button>
              {showAnswers && (
                <ol className="admin-districts">
                  {city.content.districts.map((d, i) => {
                    const task = city.content!.tasks[i]!;
                    const answer = task.type === "number" ? String(task.answer) : task.type === "text" ? (task.answers ?? []).join(" / ") : task.type === "choice" ? task.options?.[task.correct ?? 0] : (task.items ?? []).join(" → ");
                    return (
                      <li key={i}>
                        <div><strong>{d.title}</strong> <span className="muted">{d.verses}</span></div>
                        <div className="muted" style={{ fontSize: ".85rem" }}>{d.summary}</div>
                        <div style={{ marginTop: ".25rem" }}>{task.prompt}</div>
                        <div className="note ok" style={{ margin: ".25rem 0 0" }}>{t("Ответ: {a} · знак шифра {c}", { a: answer ?? "", c: city.node.cityCode?.[i] ?? "?" })}</div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Тестовая кнопка админа: открыть узел команде (сторона к нему считается пройденной). */
function RevealButtons({ gameId, nodeKey, teams, revealedBy }: { gameId: string; nodeKey: string; teams: Array<{ id: string; name: string; color: string }>; revealedBy: Array<{ id: string }> }) {
  const { confirm, notify } = useUi();
  const seen = new Set(revealedBy.map((tm) => tm.id));
  const rest = teams.filter((tm) => !seen.has(tm.id));
  if (rest.length === 0) return null;
  async function reveal(tm: { id: string; name: string }) {
    if (!(await confirm(t("Открыть этот узел команде «{name}»? Это тестовое действие: сторона к узлу будет считаться пройденной.", { name: tm.name }), { okLabel: t("Открыть") }))) return;
    try { await api(`/api/games/${gameId}/teams/${tm.id}/reveal`, { method: "POST", body: JSON.stringify({ nodeKey }) }); notify(t("Узел открыт команде «{name}»", { name: tm.name })); }
    catch (e) { notify(e instanceof Error ? e.message : t("Ошибка"), "bad"); }
  }
  return (
    <div className="row" style={{ marginTop: ".4rem", gap: ".4rem", flexWrap: "wrap" }}>
      {rest.map((tm) => <button key={tm.id} className="secondary sm" style={{ borderColor: tm.color }} onClick={() => void reveal(tm)}>{t("Открыть для «{name}»", { name: tm.name })}</button>)}
    </div>
  );
}

/** Тестовая кнопка админа: присвоить город команде (все районы решены, город занят ею). */
function AssignButtons({ gameId, nodeKey, teams }: { gameId: string; nodeKey: string; teams: Array<{ id: string; name: string; color: string; capturedAt: string | null }> }) {
  const { confirm, notify } = useUi();
  const rest = teams.filter((tm) => !tm.capturedAt);
  if (rest.length === 0) return null;
  async function assign(tm: { id: string; name: string }) {
    if (!(await confirm(t("Присвоить город команде «{name}»? Тестовое действие: все районы будут считаться решёнными, город занят этой командой, прежний владелец его теряет.", { name: tm.name }), { okLabel: t("Присвоить") }))) return;
    try { const r = await api<{ isCapital: boolean }>(`/api/games/${gameId}/cities/${encodeURIComponent(nodeKey)}/assign`, { method: "POST", body: JSON.stringify({ teamId: tm.id }) }); notify(t("Город присвоен команде «{name}»", { name: tm.name }) + (r.isCapital ? t(" — это её столица") : "")); }
    catch (e) { notify(e instanceof Error ? e.message : t("Ошибка"), "bad"); }
  }
  async function study(tm: { id: string; name: string }) {
    if (!(await confirm(t("Зачесть команде «{name}» все задания этого города? Тестовое действие: районы собраны, задания решены, город не взят — можно сразу вводить ключ или бросать вызов.", { name: tm.name }), { okLabel: t("Зачесть") }))) return;
    try { await api(`/api/games/${gameId}/cities/${encodeURIComponent(nodeKey)}/study`, { method: "POST", body: JSON.stringify({ teamId: tm.id }) }); notify(t("Задания зачтены команде «{name}»", { name: tm.name })); }
    catch (e) { notify(e instanceof Error ? e.message : t("Ошибка"), "bad"); }
  }
  return (
    <div className="row" style={{ marginTop: ".4rem", gap: ".4rem", flexWrap: "wrap" }}>
      {rest.map((tm) => <button key={tm.id} className="secondary sm" style={{ borderColor: tm.color }} onClick={() => void assign(tm)}>{t("Присвоить «{name}»", { name: tm.name })}</button>)}
      {rest.map((tm) => <button key={"s" + tm.id} className="ghost sm" onClick={() => void study(tm)}>{t("Зачесть задания «{name}»", { name: tm.name })}</button>)}
    </div>
  );
}
