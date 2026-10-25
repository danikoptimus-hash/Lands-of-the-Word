import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { t } from "../lib/i18n";

/**
 * Вступление для тех, кто зашёл впервые (решение владельца 25.10): десять экранов «о чём игра» с настоящими
 * картинками экранов, листаются свайпом, стрелками и клавишами; крестик справа вверху закрывает. Показывается до
 * регистрации на гостевых страницах один раз на устройстве (отметка в localStorage: незарегистрированного больше
 * узнать не по чему), дальше открывается кнопкой «О игре» и из «Как играть». `?intro=1` показывает снова.
 */
const KEY = "lotw.intro.seen";
export function introSeen(): boolean { try { return localStorage.getItem(KEY) === "1"; } catch { return true; } }
export function markIntroSeen(): void { try { localStorage.setItem(KEY, "1"); } catch { /* приватный режим: покажем ещё раз */ } }
export function introForced(): boolean { try { return new URLSearchParams(window.location.search).get("intro") === "1"; } catch { return false; } }

type Slide = { img: string; wide?: boolean; title: () => string; text: () => string; hero?: boolean };
const SLIDES: Slide[] = [
  { img: "/img/brand/hero.webp", wide: true, hero: true, title: () => t("Земли Слова"), text: () => t("Игра для молодёжи церкви: команды идут по карте двух островов, делают добрые дела и открывают книги Библии.") },
  { img: "/img/guide/islands.webp", title: () => t("Карта"), text: () => t("Два острова, перекрёстки и дороги. Туман скрывает землю, пока команда не пройдёт по ней.") },
  { img: "/img/guide/deed.webp", title: () => t("Дела"), text: () => t("На каждой стороне дороги лежит дело: позвонить одинокому, помочь по хозяйству, выучить стих. Сделал — сдал отчёт, дорога открылась.") },
  { img: "/img/guide/city.webp", title: () => t("Города"), text: () => t("Город — книга Библии. Читайте главы, решайте задания районов, найдите знак и ключ от конверта.") },
  { img: "/img/guide/standings.webp", title: () => t("Испытания"), text: () => t("За город можно бросить вызов: стихи наизусть на время. Кто знает Слово лучше, тот и владеет городом.") },
  { img: "/img/guide/roster.webp", title: () => t("Команда и роли"), text: () => t("Капитан раздаёт роли: разведчик, пророк, посол, кормчий, воин. Каждый важен.") },
  { img: "/img/guide/fireworks.webp", title: () => t("Живая карта"), text: () => t("Ночью города спят, по расписанию приходит шторм, а над взятым городом бьёт салют.") },
  { img: "/img/guide/service.webp", title: () => t("Летопись и моё служение"), text: () => t("Каждое дело записано: лента команды и личная сводка служения каждого.") },
  { img: "/img/guide/admin-map.webp", wide: true, title: () => t("Администратору"), text: () => t("Проверка дел, таблица команд, аналитика сезона — всё в одном месте.") },
  { img: "/img/guide/games.webp", title: () => t("Начать"), text: () => t("Зарегистрируйтесь или войдите, создайте игру или примите приглашение команды.") },
];

export function IntroStory({ onClose, actions }: { onClose: () => void; /** Кнопки последнего экрана: у гостя «Войти», у вошедшего — закрыть. */ actions?: ReactNode }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const n = SLIDES.length, last = i === n - 1;
  const go = useCallback((to: number) => { if (to < 0 || to >= n) return; setDir(to > i ? 1 : -1); setI(to); }, [i, n]);
  const close = useCallback(() => { markIntroSeen(); onClose(); }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => { window.removeEventListener("keydown", onKey); document.body.classList.remove("no-scroll"); };
  }, [i, go, close]);
  // Картинка следующего экрана подгружается заранее, чтобы листание не моргало.
  useEffect(() => { const next = SLIDES[i + 1]; if (next) { const im = new Image(); im.src = next.img; } }, [i]);
  // Свайп: палец ушёл дальше 50 px по горизонтали и меньше по вертикали.
  const start = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = start.current; start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? i + 1 : i - 1);
  };
  const s = SLIDES[i]!;
  return (
    <div className="intro" role="dialog" aria-modal="true" aria-label={t("О игре")} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="intro-bg" aria-hidden="true" />
      <button type="button" className="intro-close" onClick={close} aria-label={t("Закрыть")} title={t("Закрыть")}><Icon name="x" /></button>
      <div className={"intro-slide" + (s.wide ? " wide" : "") + (s.hero ? " hero" : "") + (dir > 0 ? " fwd" : " back")} key={i}>
        <div className="intro-pic">
          {s.hero
            ? <div className="intro-hero" style={{ backgroundImage: `url(${s.img})` }}><img src="/img/brand/logo-256.png" alt="" width={96} height={96} /></div>
            : <img src={s.img} alt="" className={s.wide ? "shot wide" : "shot phone"} />}
        </div>
        <div className="intro-text">
          <p className="intro-step">{t("Экран {n} из {m}", { n: i + 1, m: n })}</p>
          <h2>{s.title()}</h2>
          <p>{s.text()}</p>
          {last && <div className="intro-actions">{actions ?? <button type="button" onClick={close}>{t("Начать")}</button>}<Link to="/how-to-play" className="btn ghost" onClick={close}><Icon name="help" />{t("Как играть")}</Link></div>}
        </div>
      </div>
      <div className="intro-nav">
        <button type="button" className="ghost icon" onClick={() => go(i - 1)} disabled={i === 0} aria-label={t("Назад")}><Icon name="back" /></button>
        <div className="intro-dots" role="tablist">
          {SLIDES.map((_, k) => <button key={k} type="button" role="tab" aria-selected={k === i} className={k === i ? "on" : ""} onClick={() => go(k)} aria-label={t("Экран {n} из {m}", { n: k + 1, m: n })} />)}
        </div>
        {last
          ? <button type="button" className="ghost sm" onClick={close}>{t("Закрыть")}</button>
          : <button type="button" className="ghost icon flip" onClick={() => go(i + 1)} aria-label={t("Далее")}><Icon name="back" /></button>}
      </div>
    </div>
  );
}
