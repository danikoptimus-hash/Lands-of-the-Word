import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type PeaceTeamDto } from "../lib/api";
import { t } from "../lib/i18n";
import { useUi } from "../lib/ui";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

type PeaceData = { canSpeak: boolean; teams: PeaceTeamDto[] };

/**
 * Мир с другой командой — из её профиля (решение владельца 04.11: «кнопка „Предложить мир“ должна также переехать в профиль
 * команды»; до того — меню «⋯» в рейтинге). Капитану, заместителю или послу: «Предложить мир» (со сроком в днях, решение
 * владельца 22.10) или «Расторгнуть мир» (только старый мир без срока). Принять или отклонить входящее предложение —
 * по-прежнему в «Командах».
 */
export function PeaceActions({ gameId, teamId }: { gameId: string; teamId: string }) {
  const { notify, confirm } = useUi();
  const [data, setData] = useState<PeaceData | null>(null);
  const [offer, setOffer] = useState(false);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<PeaceData>(`/api/games/${gameId}/peace`).then(setData).catch(() => {}), [gameId]);
  useEffect(() => { void load(); }, [load]);
  const p = data?.canSpeak ? data.teams.find((x) => x.team.id === teamId) ?? null : null;
  if (!p || p.team.status === "defeated") return null;
  async function call(path: string, body: unknown, ok: string) {
    setBusy(true);
    try { await api(path, { method: "POST", body: JSON.stringify(body) }); notify(ok); await load(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  async function breakPeace() {
    if (!(await confirm(t("Расторжение вступает в силу сразу, об этом узнают все команды."), { title: t("Расторгнуть мир с «{team}»?", { team: p!.team.name }), okLabel: t("Расторгнуть") }))) return;
    await call(`/api/games/${gameId}/peace/${p!.peaceId}/break`, {}, t("Мир расторгнут"));
  }
  return (
    <div className="row team-invites peace-actions">
      {p.state === "none" && <button type="button" className="secondary sm" disabled={busy} onClick={() => setOffer(true)}><Icon name="handshake" />{t("Предложить мир")}</button>}
      {p.state === "peace" && p.breakable && <button type="button" className="secondary sm" disabled={busy} onClick={() => void breakPeace()}><Icon name="x" />{t("Расторгнуть мир")}</button>}
      {p.state === "offered" && <span className="muted small"><Icon name="handshake" />{t("мир предложен")}</span>}
      {offer && (
        <Sheet size="sm" title={t("Предложить мир команде «{team}»", { team: p.team.name })} onClose={() => setOffer(false)}>
          <p className="hint">{t("Пока мир действует, команды не бросают вызов городам друг друга и не объявляют осад. Расторгнуть мир раньше срока нельзя.")}</p>
          <form className="peace-terms" onSubmit={(e) => { e.preventDefault(); if (days >= 1 && days <= 365) { setOffer(false); void call(`/api/games/${gameId}/peace`, { teamId, days }, t("Мир предложен")); } }}>
            <label htmlFor="peace-days">{t("На сколько дней")}</label>
            <input id="peace-days" type="number" inputMode="numeric" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} autoFocus />
            <button type="submit" disabled={!(days >= 1 && days <= 365)}><Icon name="handshake" />{t("Предложить мир на {n} дн.", { n: days })}</button>
          </form>
        </Sheet>
      )}
    </div>
  );
}
