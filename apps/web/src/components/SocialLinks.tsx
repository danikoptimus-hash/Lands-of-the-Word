import { useId } from "react";
import { t } from "../lib/i18n";

/**
 * Значки соцсетей внизу главной (решения владельца 09.11): плитки в стиле игры — та же полупрозрачная пергаментная
 * подложка, что у кнопок главной, логотип бронзой; узнаваемые формы — самолётик Telegram и камера Instagram.
 * Порядок: два канала Telegram рядом (канал игры, «В начале было Слово»), правее — Instagram игры.
 */
export const SOCIAL = [
  { key: "tg-game", href: "https://t.me/landsoftheword", kind: "telegram" as const, label: () => t("Канал игры") },
  { key: "tg-word", href: "https://t.me/the_Word_was_God", kind: "telegram" as const, label: () => t("В начале было Слово") },
  { key: "ig", href: "https://www.instagram.com/zemli_slova", kind: "instagram" as const, label: () => t("Instagram игры") },
];

/** Самолётик Telegram цветом текста (currentColor): вырез из фирменного знака, увеличенный на всю плитку. */
export function TelegramMark({ size = 30 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="social-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <mask id={`tgm-${id}`}>
          <circle cx="12" cy="12" r="11.9" fill="#fff" />
          <path fill="#000" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </mask>
      </defs>
      <g transform="translate(12 12) scale(1.75) translate(-11.4 -12.1)"><rect width="24" height="24" fill="currentColor" mask={`url(#tgm-${id})`} /></g>
    </svg>
  );
}

/** Камера Instagram линиями цветом текста. */
export function InstagramMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="social-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.4" fill="none" stroke="currentColor" strokeWidth="2.1" />
      <circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" strokeWidth="2.1" />
      <circle cx="17.4" cy="6.6" r="1.35" fill="currentColor" />
    </svg>
  );
}

/** Ряд значков соцсетей: под всеми кнопками главной, одинаково на компьютере и телефоне. */
export function SocialLinks() {
  return (
    <nav className="home-social" aria-label={t("Мы в соцсетях")}>
      {SOCIAL.map((s) => (
        <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer" title={s.label()}>
          <span className="social-tile">{s.kind === "telegram" ? <TelegramMark /> : <InstagramMark />}</span>
          <span className="cap">{s.label()}</span>
        </a>
      ))}
    </nav>
  );
}
