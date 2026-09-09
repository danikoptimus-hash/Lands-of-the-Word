import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">Lands of the Word · Земли Слова</Link>
        {user && (
          <span className="row">
            <span className="muted">{user.displayName ?? user.nickname}{user.platformRole === "SUPERADMIN" ? " · суперадмин" : ""}</span>
            <button className="secondary" onClick={() => void logout()}>Выйти</button>
          </span>
        )}
      </header>
      <main className="container"><Outlet /></main>
    </>
  );
}
