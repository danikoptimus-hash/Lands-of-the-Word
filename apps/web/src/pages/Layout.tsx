import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { t } from "../lib/i18n";
import { ActionMenu } from "../components/ActionMenu";
import { Icon } from "../components/Icon";

/** Шапка: логотип и один элемент пользователя с меню (Аккаунт · Аналитика · Обращения · Выйти). На экранах карты (команда, игра администратора) шапки нет. */
export function Layout() {
  const { user, logout, logoutAll, accounts, switchAccount } = useAuth();
  const others = accounts.filter((a) => !a.active);
  const navigate = useNavigate();
  const name = user?.displayName ?? user?.nickname ?? "";
  const path = useLocation().pathname;
  const superadmin = user?.platformRole === "SUPERADMIN";
  // Открытые обращения в поддержку: красный кружок на аватаре и у пункта меню; обновляется при смене страницы,
  // раз в минуту и после закрытия обращения (событие lotw:support).
  const [openSupport, setOpenSupport] = useState(0);
  useEffect(() => {
    if (!superadmin) { setOpenSupport(0); return; }
    let alive = true;
    const load = () => api<{ open: number }>("/api/admin/support/count").then((r) => { if (alive) setOpenSupport(r.open); }).catch(() => undefined);
    load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener("lotw:support", load);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("lotw:support", load); };
  }, [superadmin, path]);
  const bare = /^\/games\/[^/]+(\/team)?$/.test(path) && path !== "/games/new";
  if (bare) return <Outlet />;
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand"><img className="mark" src="/img/brand/logo-64.png" alt="" width={32} height={32} />{t("Земли Слова")}</Link>
          {user && (
            <ActionMenu
              label={t("Меню пользователя")}
              trigger={<button type="button" className="user-menu"><span className="avatar">{name.slice(0, 1).toUpperCase()}{openSupport > 0 && <span className="user-badge" aria-label={t("Открытых обращений: {n}", { n: openSupport })}>{openSupport}</span>}</span><span className="name">{name}</span><Icon name="chevron-down" className="i-sm" /></button>}
              items={[
                { label: others.length ? `${t("Аккаунт")} · ${name}` : t("Аккаунт"), icon: "user", onSelect: () => navigate("/account") },
                ...(superadmin ? [{ label: t("Аналитика"), icon: "eye", onSelect: () => navigate("/admin") }, { label: t("Обращения"), icon: "send", badge: openSupport, onSelect: () => navigate("/admin/support") }] : []),
                // Смена аккаунта (решение владельца 05.10): другие аккаунты устройства одним нажатием, «Добавить аккаунт» — вход без выхода из текущего.
                ...others.map((a, i) => ({ label: a.displayName || a.nickname, icon: "user", onSelect: () => void switchAccount(a.id), sep: i === 0 })),
                { label: t("Добавить аккаунт"), icon: "plus", onSelect: () => navigate("/login?add=1"), sep: others.length === 0 },
                { label: others.length ? t("Выйти из этого аккаунта") : t("Выйти"), icon: "logout", onSelect: () => void logout(), sep: true },
                ...(others.length ? [{ label: t("Выйти из всех"), icon: "logout", danger: true, onSelect: () => void logoutAll() }] : []),
              ]}
            />
          )}
        </div>
      </header>
      <main className="container"><Outlet /></main>
    </>
  );
}
