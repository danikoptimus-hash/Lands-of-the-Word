import { Link, useNavigate } from "react-router-dom";
import { Icon } from "./Icon";

/** Единая кнопка «назад»: иконка + подпись, куда ведёт. to="-1" — назад по истории. */
export function Back({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  if (to === "-1") return <button type="button" className="crumb ghost" onClick={() => navigate(-1)}><Icon name="back" />{label}</button>;
  return <Link to={to} className="crumb"><Icon name="back" />{label}</Link>;
}
