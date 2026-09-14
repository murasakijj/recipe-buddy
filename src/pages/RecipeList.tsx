import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useRecipes } from "../contexts/useRecipes";
import type { Recipe } from "../lib/types";

export default function RecipeList() {
  const { recipes, loading, error } = useRecipes();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => {
      if (r.category) set.add(r.category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }, [recipes]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => r.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }, [recipes]);

  const recipesById = useMemo(() => {
    const map = new Map<string, Recipe>();
    recipes.forEach((r) => map.set(r.id, r));
    return map;
  }, [recipes]);

  const filtered = useMemo(() => {
    const term = search.trim();
    return recipes.filter((r) => {
      if (term && !r.title.includes(term)) return false;
      if (category !== "all" && r.category !== category) return false;
      if (
        selectedTags.length > 0 &&
        !selectedTags.every((tag) => r.tags.includes(tag))
      ) {
        return false;
      }
      return true;
    });
  }, [recipes, search, category, selectedTags]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  return (
    <AppShell>
      <div className="page-header">
        <h1>レシピ一覧</h1>
        <div className="page-header-actions">
          <Link to="/techniques" className="btn">
            共通テクニック
          </Link>
          <Link to="/recipes/new" className="btn btn-primary">
            新規登録
          </Link>
        </div>
      </div>

      <div className="filters">
        <input
          type="search"
          placeholder="レシピ名で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="レシピ名で検索"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="カテゴリで絞り込み"
        >
          <option value="all">すべてのカテゴリ</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {allTags.length > 0 && (
          <div className="tag-chips">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={
                  selectedTags.includes(tag)
                    ? "tag-chip tag-chip-active"
                    : "tag-chip"
                }
                onClick={() => toggleTag(tag)}
                aria-pressed={selectedTags.includes(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <p>読み込み中...</p>}
      {error && <p role="alert">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p className="empty-state">
          {recipes.length === 0
            ? "レシピがまだ登録されていません。「新規登録」から追加してください。"
            : "条件に一致するレシピがありません。"}
        </p>
      )}

      <ul className="recipe-list">
        {filtered.map((r) => (
          <li key={r.id} className="card recipe-card">
            <Link to={`/recipes/${r.id}`} className="recipe-card-link">
              <div className="recipe-card-title-row">
                <span className="recipe-card-title">{r.title}</span>
                {r.sourceType === "ai_arranged" && (
                  <span className="badge badge-ai">AIアレンジ</span>
                )}
                {r.parentRecipeId ? (
                  <span className="badge">
                    子（元: {recipesById.get(r.parentRecipeId)?.title ?? "不明"}
                    ）
                  </span>
                ) : (
                  <span className="badge">親</span>
                )}
              </div>
              <div className="recipe-card-meta">
                {r.category && (
                  <span className="recipe-card-category">{r.category}</span>
                )}
                {r.tags.length > 0 && (
                  <span className="recipe-card-tags">{r.tags.join(", ")}</span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
