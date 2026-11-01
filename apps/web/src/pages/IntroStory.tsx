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

type Slide = { img: string; /** Видео вместо картинки (mp4 и webm), картинка — постер. */ video?: { mp4: string; webm: string }; wide?: boolean; title: () => string; text: () => string };
/**
 * Экраны (переделка по решениям владельца 01.11): настоящие снимки с человеческими никами, карта двух островов с компьютера,
 * времена суток четырьмя телефонами, шторм и ночь — короткие видео, отдельные экраны про награды и серию дней.
 * Файлы — `public/img/intro/*`; снимки делаются скриптом на локальной игре с тестовыми участниками.
 */
const SLIDES: Slide[] = [
  { img: "/img/intro/table.webp", wide: true, title: () => t("Земли Слова"), text: () => t("Игра для молодёжи церкви: команды идут по карте двух островов, делают добрые дела, открывают города и изучают книги Библии.") },
  { img: "/img/intro/map-day.webp", wide: true, title: () => t("Карта"), text: () => t("Два острова — Ветхий и Новый Завет. Перекрёстки, дороги и города-книги. Туман скрывает землю, пока команда не пройдёт по ней.") },
  { img: "/img/guide/deed.webp", title: () => t("Дела"), text: () => t("На каждой стороне дороги лежит дело: позвонить одинокому, помочь по хозяйству, выучить стих. Сделал — прикрепи фото или видео, администратор примет, и дорога пройдена.") },
  { img: "/img/guide/city.webp", title: () => t("Города"), text: () => t("Город — книга Библии. Читайте главы, решайте задания районов, найдите знак и ключ от конверта.") },
  { img: "/img/intro/trials.webp", wide: true, title: () => t("Испытания"), text: () => t("Город другой команды можно взять. Команда делает вызов и учит наизусть отрывок из книги этого города. Когда администратор принял стихи, капитан начинает испытание — и у хранителей ровно столько же времени, чтобы ответить своими стихами. Кто знает Слово лучше, тот и владеет городом. Каждый шаг виден на шкале.") },
  { img: "/img/intro/roster.webp", title: () => t("Команда и роли"), text: () => t("Капитан раздаёт роли. Разведчик раз в неделю смотрит, что за соседней стороной. Пророк зажигает свечу к заданию города и видит письмо с подсказкой. Посол просит проходы через чужие города и предлагает мир. Кормчий ведёт корабль на другой остров. Воин учит стихи в испытаниях, и каждый его стих считается за два.") },
  { img: "/img/intro/tod.webp", wide: true, title: () => t("Времена суток"), text: () => t("Утро, день, вечер и ночь по местному времени: карта меняет свет. Ночью города спят, дела и испытания ждут 7:00.") },
  { img: "/img/intro/storm-poster.webp", video: { mp4: "/img/intro/storm.mp4", webm: "/img/intro/storm.webm" }, wide: true, title: () => t("Шторм"), text: () => t("По расписанию приходит шторм: дождь и молнии над островами. Пока идёт буря, можно только смотреть карту, а время испытаний стоит.") },
  { img: "/img/intro/journal.webp", wide: true, title: () => t("Летопись и моё служение"), text: () => t("Каждое дело записано: летопись команды день за днём и личная сводка служения — сколько дел, районов, городов и стихов за игру.") },
  { img: "/img/intro/awards.webp", title: () => t("Награды"), text: () => t("За дела, стихи, города и верность команда и каждый участник получают значки. Они собираются в «Моём служении» и в рейтингах команд.") },
  { img: "/img/intro/streak.webp", title: () => t("Серия дней"), text: () => t("Каждый день с делом или стихом продлевает серию. Огонёк на карте показывает, засчитан ли сегодняшний день, а неделя — какие дни были.") },
  { img: "/img/intro/map-evening.webp", wide: true, title: () => t("Администратору"), text: () => t("Проверка дел и испытаний, таблица команд, аналитика сезона и настройки — всё в одном месте, на компьютере и на телефоне.") },
  { img: "/img/intro/map-night.webp", wide: true, title: () => t("Начать"), text: () => t("Зарегистрируйтесь или войдите, создайте игру или примите приглашение команды.") },
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
      <div className={"intro-slide" + (s.wide ? " wide" : "") + (dir > 0 ? " fwd" : " back")} key={i}>
        <div className="intro-pic">
          {s.video
            ? <video className={s.wide ? "shot wide" : "shot phone"} autoPlay muted loop playsInline poster={s.img} key={s.video.mp4}><source src={s.video.mp4} type="video/mp4" /><source src={s.video.webm} type="video/webm" /></video>
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
        <button type="button" className="ghost icon flip" onClick={() => go(i + 1)} disabled={last} aria-label={t("Далее")}><Icon name="back" /></button>
      </div>
    </div>
  );
}
