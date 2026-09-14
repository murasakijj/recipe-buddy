import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/useAuth";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, accessDenied, authError, retryAuthorization } =
    useAuth();

  if (loading) {
    return <p>読み込み中...</p>;
  }

  if (!user || accessDenied) {
    return <Navigate to="/login" replace />;
  }

  if (authError) {
    return (
      <main>
        <p role="alert">認証サーバーに接続できませんでした。</p>
        <button type="button" onClick={() => void retryAuthorization()}>
          再試行
        </button>
      </main>
    );
  }

  return <>{children}</>;
}
