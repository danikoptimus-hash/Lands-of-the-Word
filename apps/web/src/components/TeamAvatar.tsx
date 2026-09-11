/** Команда всегда показывается одинаково: кружок цвета команды с первой буквой + название рядом (по желанию). */
export function TeamAvatar({ name, color, size, withName = false }: { name: string; color: string; size?: "sm" | "lg"; withName?: boolean }) {
  const a = <span className={"avatar team" + (size ? " " + size : "")} style={{ ["--team" as string]: color }} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
  if (!withName) return a;
  return <span className="person">{a}<span className="name">{name}</span></span>;
}
