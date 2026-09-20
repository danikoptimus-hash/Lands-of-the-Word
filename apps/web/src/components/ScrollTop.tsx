import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { t } from "../lib/i18n";

/** Кнопка «наверх» для длинных страниц (решение владельца 20.09): появляется после прокрутки на экран вниз, плавно возвращает к началу. */
export function ScrollTop() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const on = () => setShown(window.scrollY > window.innerHeight * 0.8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (!shown) return null;
  return (
    <button type="button" className="scroll-top" aria-label={t("Наверх")} title={t("Наверх")} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
      <Icon name="arrow-up" />
    </button>
  );
}
