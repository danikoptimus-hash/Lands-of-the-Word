import { Icon } from "./Icon";
import { t } from "../lib/i18n";

export type LinkKind = "photo" | "video" | "link";
/** Чем сдаётся дело → вид кнопки ссылки: фото, видео, а для аудио и прочего — просто ссылка. */
export const linkKind = (proofType: string): LinkKind => (proofType === "PHOTO_LINK" ? "photo" : proofType === "VIDEO_LINK" ? "video" : "link");

/**
 * Ссылки сдачи — квадратные кнопки со значком (фото, видео, ссылка) и номером, если ссылок несколько; подпись «Фото 1»
 * только во всплывающей подсказке. В проверке стоят в ряду действий перед «Принять» (решение владельца 06.11: «убираем
 * текст „фото“ и ставим квадратную кнопку перед „Принять“»; до этого видео было значком с 31.10, фото — текстом).
 * С 14.11 так же показаны ссылки в карточке дела у участника и в отчёте по делу у администратора: до этого там
 * оставался список голых адресов (замечание владельца 14.11).
 */
export function LinkList({ links, kind }: { links: string[]; kind: LinkKind }) {
  if (links.length === 0) return null;
  const word = kind === "photo" ? t("Фото") : kind === "video" ? t("Видео") : t("Ссылка");
  const label = (i: number) => (links.length > 1 ? `${word} ${i + 1}` : word);
  const icon = kind === "photo" ? "camera" : kind === "video" ? "video" : "link";
  return <>{links.map((l, i) => <a key={l + i} className="btn secondary sm icon proof-btn" href={l} target="_blank" rel="noopener noreferrer" aria-label={label(i)} title={label(i)}><Icon name={icon} />{links.length > 1 && <i className="n">{i + 1}</i>}</a>)}</>;
}
