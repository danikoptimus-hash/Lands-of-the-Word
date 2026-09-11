import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { t } from "../lib/i18n";
import { ActionMenu } from "../components/ActionMenu";
import { Icon } from "../components/Icon";

/** Шапка: логотип и один элемент пользователя с меню (Аккаунт · Аналитика · Выйти). На экране карты шапки нет. */
export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const name = user?.displayName ?? user?.nickname ?? "";
  const bare = /^\/games\/[^/]+\/team$/.test(useLocation().pathname);
  if (bare) return <Outlet />;
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand"><img className="mark" src="/img/brand/logo-64.png" alt="" width={32} height={32} />{t("Земли Слова")}</Link>
          {user && (
            <ActionMenu
              label={t("Меню пользователя")}
              trigger={<button type="button" className="user-menu"><span className="avatar">{name.slice(0, 1).toUpperCase()}</span><span className="name">{name}</span><Icon name="chevron-down" className="i-sm" /></button>}
              items={[
                { label: t("Аккаунт"), icon: "user", onSelect: () => navigate("/account") },
                ...(user.platformRole === "SUPERADMIN" ? [{ label: t("Аналитика"), icon: "eye", onSelect: () => navigate("/admin") }] : []),
                { label: t("Выйти"), icon: "logout", onSelect: () => void logout(), sep: true },
              ]}
            />
          )}
        </div>
      </header>
      <main className="container"><Outlet /></main>
    </>
  );
}
