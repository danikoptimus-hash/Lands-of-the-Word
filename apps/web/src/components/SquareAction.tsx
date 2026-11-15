import { Icon } from "./Icon";
import { HelpPopup } from "./Help";

/**
 * Квадратная кнопка действия со значком и маленьким «?» в правом верхнем углу (решение владельца 14.11: «кнопки сделаем
 * квадратными и оставим только значки… над каждой кнопкой маленький вопросительный значок в правом верхнем углу с
 * объяснением, что за кнопка»). Название и пояснение — в окошке по нажатию на «?»; название же — подпись для чтения с экрана.
 */
/**
 * asleep — ночь: кнопка стоит на месте, как днём, но по нажатию вместо действия всплывает подсказка, что сейчас ночь
 * (решение владельца 15.11: «вернуть все кнопки, которые есть днём, но при нажатии на них ночью высвечивать подсказку
 * с информацией о том, что сейчас ночь и сделать что-либо невозможно»; отдельной строки со знаком месяца нет).
 */
export function SquareAction({ icon, label, help, onClick, disabled, primary = false, on, badge, className, asleep }: { /** Текст ночной подсказки: если задан, нажатие показывает его и ничего не делает. */ asleep?: string; icon: string; label: string; help: string; onClick: () => void; disabled?: boolean; /** Главное действие — залитая кнопка. */ primary?: boolean; /** Нажатое состояние переключателя (приоритет отмечен). */ on?: boolean; /** Число в углу (камни Каменоломни). */ badge?: number | null; className?: string }) {
  return (
    <span className={"sq-act" + (className ? " " + className : "")}>
      {asleep ? (
        <HelpPopup name={label} className="sq-asleep" buttonClassName={(primary ? "" : "secondary ") + "sq-btn asleep" + (on ? " on" : "")} trigger={<><Icon name={icon} />{badge != null && <span className="count-chip">{badge}</span>}</>}>
          <p className="night-pop"><Icon name="moon" /><span>{asleep}</span></p>
        </HelpPopup>
      ) : (
      <button type="button" className={(primary ? "" : "secondary ") + "sq-btn" + (on ? " on" : "")} aria-label={label} title={label} aria-pressed={on} disabled={disabled} onClick={onClick}>
        <Icon name={icon} />{badge != null && <span className="count-chip">{badge}</span>}
      </button>
      )}
      <HelpPopup name={label} className="sq-help"><p><b>{label}.</b> {help}</p></HelpPopup>
    </span>
  );
}
