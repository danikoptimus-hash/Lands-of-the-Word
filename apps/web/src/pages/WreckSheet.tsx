import { useState } from "react";
import { api, ApiError, PROOF_LABEL, type WreckDto } from "../lib/api";
import { useUi } from "../lib/ui";
import { t } from "../lib/i18n";
import { fmtDate } from "../lib/format";
import { Icon } from "../components/Icon";
import { Chip } from "../components/Chip";
import { Sheet } from "../components/Sheet";
import { Help } from "../components/Help";
import { LinksField } from "../components/LinksField";
import { PeoplePicker } from "../components/PeoplePicker";
import { SinkingShip } from "../components/SinkingShip";

/**
 * Лист срочного задания с разбитого бурей корабля (решение владельца 04.11): описание дела, возможный груз (команда
 * знает, что на борту, но не знает, что выпадет), форма сдачи как у Каменоломни (ссылки, отчёт, кто участвовал).
 * Берётся как обычное дело (решение владельца 05.11): «Взять задание», после этого «Взял: имя». Берут, сдают и отказываются
 * только капитан, заместитель или летописец, задание одно на команду (откат владельца 05.11 вечером).
 * Состояния: взято; на проверке; возвращено с комментарием (взять и сдать снова); принято — что выпало, корабль уходит; затонул.
 */
export function WreckSheet({ gameId, wreck, members, canWork, canTake = true, asleep = false, container, onClose, onChanged }: { gameId: string; wreck: WreckDto; members: Array<{ id: string; name: string }>; /** Капитан, заместитель или летописец: могут взять, сдать и отказаться. */ canWork: boolean; /** Взять можно до полуночи, как обычное дело. */ canTake?: boolean; /** Ночь или шторм: сдать нельзя. */ asleep?: boolean; container: HTMLElement | null; onClose: () => void; onChanged: () => void }) {
  const { notify, confirm } = useUi();
  const [links, setLinks] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const mine = wreck.mine;
  const pending = mine?.status === "SUBMITTED", approved = mine?.status === "APPROVED", returned = mine?.status === "REJECTED", taken = mine?.status === "TAKEN";
  const sunk = Boolean(wreck.sunkAt) && !approved;
  const takerName = taken ? members.find((x) => x.id === mine?.userId)?.name ?? t("участник") : "";
  // Сдача — после взятия, как у обычного дела; только капитан, заместитель или летописец (откат владельца 05.11).
  const canSubmit = taken && canWork && !sunk;
  const canTakeNow = !taken && !pending && !approved && !sunk;
  const linksNeeded = wreck.proofType !== "REPORT" && wreck.proofType !== "WITNESS";
  async function submit() {
    if (linksNeeded && links.length === 0) { notify(t("Приложите ссылку на фото или видео"), "bad"); return; }
    if (!linksNeeded && !note.trim()) { notify(t("Напишите, что сделали"), "bad"); return; }
    setBusy(true);
    try {
      await api(`/api/games/${gameId}/wrecks/${wreck.id}/submit`, { method: "POST", body: JSON.stringify({ links, note, participants }) });
      notify(t("Сдано на проверку")); setLinks([]); setNote(""); setParticipants([]); onChanged();
    } catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  async function take() {
    setBusy(true);
    try { await api(`/api/games/${gameId}/wrecks/${wreck.id}/take`, { method: "POST", body: JSON.stringify({}) }); notify(t("Задание взято")); onChanged(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  async function release() {
    if (!(await confirm(t("Отказаться от задания?"), { title: t("Отказаться от задания") }))) return;
    setBusy(true);
    try { await api(`/api/games/${gameId}/wrecks/${wreck.id}/release`, { method: "POST", body: JSON.stringify({}) }); notify(t("Задание отпущено")); onChanged(); }
    catch (e) { notify(e instanceof ApiError ? e.message : t("Ошибка сети"), "bad"); }
    finally { setBusy(false); }
  }
  const cargoLine = approved && mine ? (mine.cargo === "STONES" ? t("Капитан отблагодарил: {n} тёсаных камней", { n: mine.amount ?? 0 }) : t("Капитан отблагодарил: {n} блоков для стен", { n: mine.amount ?? 0 })) : "";
  return (
    <Sheet size="md" container={container} onClose={onClose} className="deed-sheet wreck-sheet" head={<div className="sheet-title"><h2><Icon name="ship" />{wreck.title}</h2><Chip tone="bad" icon="alert">{t("Срочное задание")}</Chip></div>}>
      {sunk ? (
        <p className="note warn"><Icon name="alert" /><span>{t("Корабль затонул, не дождавшись помощи: задание закрыто.")}</span></p>
      ) : (
        <p className="muted small"><Icon name="ship" /> {t("Разбитый бурей корабль у берега просит помощи. Его могут выручить несколько команд.")}<Help>{t("Взять и сдать задание может капитан, заместитель или летописец; задание одно на команду. Администратор проверяет; за принятое задание команда получает что-то одно из груза — что именно, решает жребий. Корабль уходит, когда задание принято.")}</Help></p>
      )}
      {/* Срок затопления (решение владельца 05.11): обратный отсчёт и корабль, наполняющийся водой. */}
      {wreck.sinkAt && !approved && !sunk && <SinkingShip sinkAt={wreck.sinkAt} appearedAt={wreck.appearedAt} />}
      {wreck.description && <p className="deed-text">{wreck.description}</p>}
      <p className="meta"><Chip icon="camera">{PROOF_LABEL[wreck.proofType]}</Chip>{wreck.doneTeams > 0 && <span className="muted small"> · {t("уже выручили команд: {n}", { n: wreck.doneTeams })}</span>}</p>
      {/* Груз: команда знает, что на борту, но не знает, что выпадет (решение владельца 04.11). */}
      {!approved && !sunk && (
        <div className="note cargo-note">
          <Icon name="stone" />
          <span>{t("На борту: тёсаные камни и блоки для стен. Выполните это задание — капитан корабля и команда отблагодарят вас чем-то из груза: {stones} тёсаных камней или {blocks} блоков стен. Что именно — узнаете после проверки.", { stones: wreck.cargo.stones, blocks: wreck.cargo.blocks })}</span>
        </div>
      )}
      {taken && mine && <p className="meta-line"><Icon name="user" />{t("Взял: {name}", { name: takerName })}{mine.takenAt ? ` · ${fmtDate(mine.takenAt)}` : ""}</p>}
      {pending && mine && <p className="note"><Icon name="clock" /><span>{t("На проверке у администратора")} · {fmtDate(mine.submittedAt)}</span></p>}
      {returned && mine && <p className="note warn"><Icon name="back" /><span>{t("Возвращено администратором")}{mine.adminComment ? `: ${mine.adminComment}` : ""}. {t("Можно сдать снова.")}</span></p>}
      {approved && mine && (
        <div className="note ok">
          <Icon name={mine.cargo === "STONES" ? "stone" : "wall"} />
          <span><b>{cargoLine}</b><br />{mine.cargo === "STONES" ? t("Камень мостит одну свободную дорогу на карте.") : t("Блок кладётся в стену своего города: откройте город → «Стена».")} {t("Корабль починен и уходит в море.")}</span>
        </div>
      )}
      {/* Взять — как обычное дело (решение владельца 05.11), но только капитан, заместитель или летописец, до полуночи. */}
      {canTakeNow && canWork && (
        <div className="actions">
          <button type="button" disabled={busy || !canTake} onClick={() => void take()}><Icon name="scroll" />{t("Взять задание")}</button>
          {!canTake && <p className="hint">{t("Ночью с 0:00 до 7:00 по местному времени взять задание нельзя.")}</p>}
        </div>
      )}
      {canSubmit && (
        <div className="stack-sm mt-2">
          {linksNeeded && <LinksField label={wreck.proofType === "VIDEO_LINK" ? t("Ссылки на видео") : wreck.proofType === "AUDIO_LINK" ? t("Ссылка на аудиозапись") : t("Ссылки на фото или видео")} links={links} onChange={setLinks} />}
          <div className="field"><label htmlFor="wreck-note">{t("Коротко")} {linksNeeded && <span className="opt">{t("необязательно")}</span>}</label><textarea id="wreck-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Что сделали")} /></div>
          {members.length > 0 && (
            <div className="field">
              <label className="label" htmlFor="wreck-people">{t("Кто участвовал")} <span className="opt">{t("им дело пойдёт в зачёт")}</span></label>
              <PeoplePicker id="wreck-people" people={members} value={participants} onChange={setParticipants} empty={t("никого не отмечено")} />
            </div>
          )}
          <div className="actions row">
            <button type="button" disabled={busy || asleep} title={asleep ? t("Ночью и в шторм задания ждут утра") : undefined} onClick={() => void submit()}><Icon name="send" />{t("Сдать на проверку")}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void release()}>{t("Отказаться от задания")}</button>
          </div>
          {asleep && <p className="hint">{t("Ночью и в шторм задания ждут утра.")}</p>}
        </div>
      )}
      {canTakeNow && <p className="hint">{t("Взять и сдать задание может капитан, заместитель или летописец; оно одно на команду.")}</p>}
      {taken && !canSubmit && !sunk && <p className="hint"><Icon name="user" />{t("Задание взято: сдать или отказаться может капитан, заместитель или летописец.")}</p>}
    </Sheet>
  );
}
