import type { ReactNode } from "react";
import { Chip } from "./Chip";
import { HelpPopup } from "./Help";

/** Значок-цифра: значение всплывает окошком по нажатию (решение владельца 24.10: «подсказку значения значка показывать при попытке на него нажать»). */
export function StatChip({ icon, label, value }: { icon: string; label: string; value: ReactNode }) {
  return <HelpPopup name={label} trigger={<Chip icon={icon}>{value}</Chip>}><p>{label}</p></HelpPopup>;
}
