import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

/**
 * Поле, растущее по тексту (решение владельца 06.11, жалоба игрока: текст уходил за край однострочного поля):
 * сначала одна строка; как только текст упирается в край, поле становится выше ровно на столько, сколько нужно.
 * Высота считается по scrollHeight после каждого изменения и при смене ширины окна.
 */
export function AutoGrow({ value, minRows = 1, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`; };
  useLayoutEffect(fit, [value]);
  useLayoutEffect(() => { window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit); }, []);
  return <textarea ref={ref} rows={minRows} value={value} className={"autogrow" + (className ? " " + className : "")} {...rest} />;
}
