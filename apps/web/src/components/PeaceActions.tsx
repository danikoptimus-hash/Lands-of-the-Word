import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type PeaceTeamDto } from "../lib/api";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { useUi } from "../lib/ui";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

type PeaceData = { canSpeak: boolean; teams: PeaceTeamDto[] };

/** Срок мира словами (решение владельца 22.10): «до 29 окт.», «до конца игры»; у предложения — «на 7 дн.». */
export function peaceTerm(p: PeaceTeamDto): string {
  if (p.days === null || p.days === undefined) return "";
  if (p.days === 0) return t("до конца игры");
  if (p.state === "peace" && p.until) return t("до {d}", { d: fmtDate(p.until, { time: false }) });
  return t("на {n} дн.", { n: p.days });
}

/**
 * Мир с другой командой — из её профиля (решение владельца 04.11: «кнопка „Предложить мир“ должна также переехать в профиль
 * команды»; до того — меню «⋯» в рейтинге). Капитану, заместителю или послу: «Предложить мир» (со сроком в днях, решение
 * владельца 22.10) или «Расторгнуть мир» (только старый мир без срока). Принять или отклонить входящее предложение —
 * тоже здесь (решение владельца 05.11: «убрать отсюда эти кнопки, они должны появляться в профиле команды»); в ряду
 * команд остался только знак «предлагает мир».
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
      {p.state === "incoming" && (
        <>
          <span className="muted small peace-incoming"><Icon name="handshake" />{peaceTerm(p) ? `${t("предлагает мир")} ${peaceTerm(p)}` : t("предлагает мир")}</span>
          <button type="button" className="sm" disabled={busy} onClick={() => void call(`/api/games/${gameId}/peace/${p.peaceId}/accept`, {}, t("Мир заключён"))}><Icon name="check" />{t("Принять")}</button>
          <button type="button" className="secondary sm" disabled={busy} onClick={() => void call(`/api/games/${gameId}/peace/${p.peaceId}/decline`, {}, t("Предложение отклонено"))}>{t("Отклонить")}</button>
        </>
      )}
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
