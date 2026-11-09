import { useId } from "react";
import { t } from "../lib/i18n";

/**
 * Значки соцсетей внизу главной (решение владельца 09.11): квадратные плитки в фирменных цветах — Telegram (бумажный
 * самолётик на синем) и Instagram (камера на градиенте), под каждой короткая подпись. Два канала Telegram: игры и
 * «В начале было Слово» (проповеди и материалы по Библии).
 */
export const SOCIAL = [
  { key: "tg-game", href: "https://t.me/landsoftheword", kind: "telegram" as const, label: () => t("Канал игры") },
  { key: "ig", href: "https://www.instagram.com/zemli_slova", kind: "instagram" as const, label: () => "Instagram" },
  { key: "tg-word", href: "https://t.me/the_Word_was_God", kind: "telegram" as const, label: () => t("В начале было Слово") },
];

/** Логотип Telegram на квадратной плитке: белый самолётик на фирменном синем градиенте. */
export function TelegramMark({ size = 52 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="social-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`tg-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#37BBFE" /><stop offset="1" stopColor="#007DBB" /></linearGradient>
        {/* Самолётик — круг логотипа минус его «вырез»: маска белая только там, где самолётик. */}
        <mask id={`tgm-${id}`}>
          <circle cx="12" cy="12" r="11.9" fill="#fff" />
          <path fill="#000" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </mask>
      </defs>
      <rect width="24" height="24" rx="5.5" fill={`url(#tg-${id})`} />
      <g transform="translate(1.6 2.2) scale(.86)"><rect width="24" height="24" fill="#fff" mask={`url(#tgm-${id})`} /></g>
    </svg>
  );
}

/** Логотип Instagram: белая камера на фирменном градиенте. */
export function InstagramMark({ size = 52 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="social-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`ig-${id}`} cx="30%" cy="107%" r="150%">
          <stop offset="0" stopColor="#fdf497" /><stop offset=".05" stopColor="#fdf497" /><stop offset=".45" stopColor="#fd5949" />
          <stop offset=".6" stopColor="#d6249f" /><stop offset=".9" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect width="24" height="24" rx="5.5" fill={`url(#ig-${id})`} />
      <rect x="5.2" y="5.2" width="13.6" height="13.6" rx="4" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="3.3" fill="none" stroke="#fff" strokeWidth="1.7" />
      <circle cx="16.1" cy="7.9" r="1" fill="#fff" />
    </svg>
  );
}

/** Ряд значков соцсетей: под всеми кнопками главной, одинаково на компьютере и телефоне. */
export function SocialLinks() {
  return (
    <nav className="home-social" aria-label={t("Мы в соцсетях")}>
      {SOCIAL.map((s) => (
        <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer" title={s.label()}>
          {s.kind === "telegram" ? <TelegramMark /> : <InstagramMark />}
          <span>{s.label()}</span>
        </a>
      ))}
    </nav>
  );
}
