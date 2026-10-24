/**
 * Аватарка участника (решение владельца 24.10): фото, если участник его поставил, иначе кружок с первой буквой —
 * как и раньше. Один вид во всех списках.
 */
export function UserAvatar({ name, avatarId, size, className }: { name: string; avatarId?: string | null; size?: "sm" | "lg"; className?: string }) {
  const cls = "avatar" + (size ? " " + size : "") + (className ? " " + className : "");
  if (avatarId) return <span className={cls + " photo"} aria-hidden="true"><img src={`/api/avatars/${avatarId}`} alt="" loading="lazy" decoding="async" /></span>;
  return <span className={cls} aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>;
}
