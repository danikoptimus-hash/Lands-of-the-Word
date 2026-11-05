import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Тестовое переключение между ботами (решение владельца 03.11): на стенде и локально — панель, из которой можно за
 * один тап войти за любого тестового бота партии и смотреть игру его глазами. Видна только там, где бэкенд отдаёт
 * /api/dev/bots (стенд test.* и localhost); на проде этого маршрута нет (404) — панель не появляется вовсе.
 * Переключение идёт обычным входом (createSession на сервере), без пароля, и только для ботов tg_*@example.com:
 * реальные аккаунты недоступны. Компонент самодостаточен (свои стили), в словари перевода строки не попадают.
 * Время суток (решение владельца 05.11): на странице партии в панели есть кнопки «Утро… Ночь» — `POST /api/dev/daytime`
 * ставит партии пояс, в котором сейчас нужный час (правила и картинка считаются по поясу игры), «Как было» возвращает
 * исходный пояс; после смены страница перезагружается.
 */
type Bot = { nickname: string; displayName: string | null };
type DevDaytime = { phase: string; timeZone: string; local: string; origTimeZone: string | null };
const PHASES: { key: string; label: string; phase: string }[] = [
  { key: "morning", label: "Утро 7:00", phase: "morning" }, { key: "day", label: "День 12:00", phase: "day" }, { key: "evening", label: "Вечер 19:00", phase: "evening" },
  { key: "night", label: "Ночь 23:00", phase: "night" }, { key: "late", label: "Ночь 2:00", phase: "night" },
];
const PHASE_RU: Record<string, string> = { morning: "утро", day: "день", evening: "вечер", night: "ночь" };

const GROUPS: { label: string; match: (n: string) => boolean }[] = [
  { label: "Админ", match: (n) => n === "tg_admin" },
  { label: "Моряки", match: (n) => /^tg_m\d/i.test(n) },
  { label: "Берег", match: (n) => /^tg_b\d/i.test(n) },
  { label: "Пустыня", match: (n) => /^tg_p\d/i.test(n) },
];

const S: Record<string, React.CSSProperties> = {
  wrap: { position: "fixed", left: "calc(8px + env(safe-area-inset-left, 0px))", bottom: "calc(8px + env(safe-area-inset-bottom, 0px))", zIndex: 4000, font: "600 12px/1.3 system-ui, sans-serif" },
  pill: { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, border: "1px solid #b9742a", background: "#fff6e9", color: "#7a3b10", boxShadow: "0 2px 8px rgba(0,0,0,.2)", cursor: "pointer" },
  panel: { width: 230, maxHeight: "70vh", overflowY: "auto", padding: 10, borderRadius: 12, border: "1px solid #b9742a", background: "#fffdf8", color: "#2a1c0e", boxShadow: "0 6px 24px rgba(0,0,0,.28)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  group: { fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em", color: "#8a7a63", margin: "8px 0 3px" },
  row: { display: "flex", flexWrap: "wrap", gap: 4 },
  btn: { padding: "4px 8px", borderRadius: 7, border: "1px solid #d9c6a6", background: "#fff", color: "#5a3c17", cursor: "pointer", font: "600 12px system-ui" },
  active: { background: "#2f6b3a", borderColor: "#2f6b3a", color: "#fff" },
  x: { border: 0, background: "none", color: "#8a7a63", cursor: "pointer", fontSize: 16, lineHeight: 1 },
  back: { background: "#fff0e0", borderColor: "#b9742a", color: "#7a3b10" },
};

export function DevSwitcher() {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("devswitch") !== "0"; } catch { return true; } });
  const [busy, setBusy] = useState<string | null>(null);
  const gameId = /\/games\/([^/?#]+)/.exec(useLocation().pathname)?.[1] ?? null;
  const [dt, setDt] = useState<DevDaytime | null>(null);

  useEffect(() => {
    if (!gameId || gameId === "new") { setDt(null); return; }
    let alive = true;
    fetch(`/api/dev/daytime?game=${encodeURIComponent(gameId)}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setDt(d && d.phase ? d : null); })
      .catch(() => { if (alive) setDt(null); });
    return () => { alive = false; };
  }, [gameId]);

  useEffect(() => {
    fetch("/api/dev/bots", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBots(d?.bots ?? null))
      .catch(() => setBots(null));
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d?.user?.nickname ?? null))
      .catch(() => {});
  }, []);

  if (!bots || bots.length === 0) return null;

  const toggle = () => { setOpen((v) => { try { localStorage.setItem("devswitch", v ? "0" : "1"); } catch { /* ignore */ } return !v; }); };
  async function become(nickname: string) {
    setBusy(nickname);
    try {
      const r = await fetch("/api/dev/become", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ nickname }) });
      if (r.ok) { location.href = "/"; return; }
    } catch { /* ignore */ }
    setBusy(null);
  }

  async function setPhase(phase: string) {
    if (!gameId) return;
    setBusy("tod:" + phase);
    try {
      const r = await fetch("/api/dev/daytime", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ gameId, phase }) });
      if (r.ok) { location.reload(); return; }
    } catch { /* ignore */ }
    setBusy(null);
  }

  if (!open) return <div style={S.wrap}><button style={S.pill} onClick={toggle} title="Тестовое переключение за бота">🧪 боты</button></div>;

  return (
    <div style={S.wrap}>
      <div style={S.panel}>
        <div style={S.head}>
          <span>🧪 Вход за бота{me ? ` · сейчас: ${me}` : ""}</span>
          <button style={S.x} onClick={toggle} aria-label="Свернуть">×</button>
        </div>
        {dt && (
          <div>
            <div style={S.group}>Время суток · {PHASE_RU[dt.phase] ?? dt.phase} {dt.local}{dt.origTimeZone ? " · часы переведены" : ""}</div>
            <div style={S.row}>
              {PHASES.map((p) => (
                <button key={p.key} style={{ ...S.btn, ...(dt.phase === p.phase && (p.key !== "late") === (Number(dt.local.slice(0, 2)) >= 7) ? S.active : {}), ...(busy === "tod:" + p.key ? { opacity: 0.5 } : {}) }}
                  disabled={Boolean(busy)} title={`Поставить партии пояс, где сейчас ${p.label.toLowerCase()}`} onClick={() => void setPhase(p.key)}>
                  {p.label}
                </button>
              ))}
              {dt.origTimeZone && <button style={{ ...S.btn, ...S.back }} disabled={Boolean(busy)} title={`Вернуть пояс ${dt.origTimeZone}`} onClick={() => void setPhase("auto")}>Как было</button>}
            </div>
          </div>
        )}
        {GROUPS.map((g) => {
          const items = bots.filter((b) => g.match(b.nickname));
          if (!items.length) return null;
          return (
            <div key={g.label}>
              <div style={S.group}>{g.label}</div>
              <div style={S.row}>
                {items.map((b) => (
                  <button key={b.nickname} style={{ ...S.btn, ...(b.nickname === me ? S.active : {}), ...(busy === b.nickname ? { opacity: 0.5 } : {}) }}
                    disabled={Boolean(busy)} title={b.displayName ?? b.nickname} onClick={() => void become(b.nickname)}>
                    {b.nickname.replace(/^tg_/, "")}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
