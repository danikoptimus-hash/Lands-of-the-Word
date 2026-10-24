/** Команда всегда показывается одинаково: кружок цвета команды с первой буквой (или фото команды, решение владельца 24.10) + название рядом (по желанию). */
export function TeamAvatar({ name, color, avatarId, size, withName = false, title }: { name: string; color: string; /** Аватарка команды, если капитан её поставил. */ avatarId?: string | null; size?: "sm" | "lg"; withName?: boolean; /** Подсказка с названием команды, когда названия словами рядом нет. */ title?: string }) {
  const a = (
    <span className={"avatar team" + (size ? " " + size : "") + (avatarId ? " photo" : "")} style={{ ["--team" as string]: color }} aria-hidden={title ? undefined : "true"} title={title} aria-label={title}>
      {avatarId ? <img src={`/api/avatars/${avatarId}`} alt="" loading="lazy" decoding="async" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
  if (!withName) return a;
  return <span className="person">{a}<span className="name">{name}</span></span>;
}
