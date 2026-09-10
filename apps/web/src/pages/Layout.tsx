import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { t } from "../lib/i18n";

export function Layout() {
  const { user, logout } = useAuth();
  const name = user?.displayName ?? user?.nickname ?? "";
  const bare = /^\/games\/[^/]+\/team$/.test(useLocation().pathname);
  if (bare) return <Outlet />;
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand"><span className="mark" />{t("Земли Слова")} <span className="sub">· Lands of the Word</span></Link>
          {user && (
            <div className="userchip">
              <Link to="/account" className="userchip" style={{ textDecoration: "none", color: "inherit" }}><span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
              <span className="name">{name}{user.platformRole === "SUPERADMIN" ? t(" · суперадмин") : ""}</span></Link>
              {user.platformRole === "SUPERADMIN" && <Link to="/admin" className="ghost-link">{t("Аналитика")}</Link>}
              <button className="ghost" onClick={() => void logout()} title={t("Выйти")}>{t("Выйти")}</button>
            </div>
          )}
        </div>
      </header>
      <main className="container"><Outlet /></main>
    </>
  );
}
