import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useRecipes } from "../contexts/useRecipes";
import { useTechniques } from "../contexts/useTechniques";

export default function TechniqueList() {
  const { techniques, loading, error, remove } = useTechniques();
  const { recipes } = useRecipes();
  const [search, setSearch] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const referenceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    recipes.forEach((r) => {
      const idsInRecipe = new Set<string>();
      r.steps.forEach((s) =>
        s.techniqueIds.forEach((tid) => idsInRecipe.add(tid)),
      );
      idsInRecipe.forEach((tid) => counts.set(tid, (counts.get(tid) ?? 0) + 1));
    });
    return counts;
  }, [recipes]);

  const filtered = useMemo(
    () =>
      techniques.filter(
        (t) => search.trim().length === 0 || t.name.includes(search.trim()),
      ),
    [techniques, search],
  );

  async function handleDelete(id: string, name: string) {
    const count = referenceCounts.get(id) ?? 0;
    const message = `「${name}」を削除しますか？参照中レシピ ${count} 件（本文の語句はそのまま残ります）`;
    if (!window.confirm(message)) return;
    setDeleteError(null);
    try {
      await remove(id);
    } catch (err) {
      console.error("[delete]", err);
      const code = (err as { code?: string })?.code ?? "unknown";
      setDeleteError(`削除に失敗しました。(${code})`);
    }
  }

  return (
    <AppShell>
      <div className="page-header">
        <h1>共通テクニック</h1>
        <Link to="/techniques/new" className="btn btn-primary">
          新規登録
        </Link>
      </div>

      <input
        type="search"
        placeholder="名称で検索"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="名称で検索"
      />

      {loading && <p>読み込み中...</p>}
      {error && <p role="alert">{error}</p>}
      {deleteError && <p role="alert">{deleteError}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p className="empty-state">
          {techniques.length === 0
            ? "テクニックがまだ登録されていません。"
            : "条件に一致するテクニックがありません。"}
        </p>
      )}

      <ul className="technique-list">
        {filtered.map((t) => (
          <li key={t.id} className="card">
            <div className="technique-list-row">
              <div>
                <strong>{t.name}</strong>
                {t.summary && <p>{t.summary}</p>}
                <p className="technique-ref-count">
                  参照中レシピ: {referenceCounts.get(t.id) ?? 0} 件
                </p>
              </div>
              <div className="technique-list-actions">
                <Link to={`/techniques/${t.id}/edit`} className="btn">
                  編集
                </Link>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void handleDelete(t.id, t.name)}
                >
                  削除
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p>
        <Link to="/">レシピ一覧に戻る</Link>
      </p>
    </AppShell>
  );
}
