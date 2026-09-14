import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, signOutUser } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="app-title">
          recipe-buddy
        </Link>
        <div className="app-header-user">
          {user && (
            <span className="app-user-name">
              {user.displayName ?? user.email}
            </span>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => void signOutUser()}
          >
            ログアウト
          </button>
        </div>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
