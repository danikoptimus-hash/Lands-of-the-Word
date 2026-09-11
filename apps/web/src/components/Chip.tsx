import { Icon } from "./Icon";

export type ChipTone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info" | "team" | "solid";
/** Пилюля статуса/роли. Цвет — только по смыслу: ok / warn / bad / info; team — цвет команды. */
export function Chip({ tone = "neutral", icon, children, color, title }: { tone?: ChipTone; icon?: string; children: React.ReactNode; color?: string; title?: string }) {
  return <span className={"chip" + (tone !== "neutral" ? " " + tone : "")} style={color ? { ["--team" as string]: color } : undefined} title={title}>{icon && <Icon name={icon} />}{children}</span>;
}
