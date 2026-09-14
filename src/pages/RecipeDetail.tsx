import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import StepText from "../components/StepText";
import { useRecipes } from "../contexts/useRecipes";
import { useTechniques } from "../contexts/useTechniques";
import type { Technique } from "../lib/types";

export default function RecipeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { recipes, loading, error, remove } = useRecipes();
  const { techniques } = useTechniques();

  const recipe = recipes.find((r) => r.id === id);
  const parent = recipe?.parentRecipeId
    ? recipes.find((r) => r.id === recipe.parentRecipeId)
    : null;
  const children = recipe
    ? recipes.filter((r) => r.parentRecipeId === recipe.id)
    : [];

  const techniqueMap = useMemo(() => {
    const map: Record<string, Technique> = {};
    techniques.forEach((t) => {
      map[t.id] = t;
    });
    return map;
  }, [techniques]);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!recipe) return;
    const message =
      children.length > 0
        ? `このレシピを削除しますか？子レシピ ${children.length} 件は親なしのレシピとして残ります。`
        : "このレシピを削除しますか？";
    if (!window.confirm(message)) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      await remove(recipe.id);
      navigate("/");
    } catch {
      setDeleteError("削除に失敗しました。");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <p>読み込み中...</p>
      </AppShell>
    );
  }
  if (error) {
    return (
      <AppShell>
        <p role="alert">{error}</p>
      </AppShell>
    );
  }
  if (!recipe) {
    return (
      <AppShell>
        <p>レシピが見つかりません。</p>
        <Link to="/">レシピ一覧に戻る</Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-header">
        <h1>{recipe.title}</h1>
        {recipe.sourceType === "ai_arranged" && (
          <span className="badge badge-ai">AIアレンジ</span>
        )}
      </div>

      {recipe.sourceType === "ai_arranged" && (
        <p className="notice">
          AIが生成したアレンジです。
          {recipe.arrangementRequest &&
            `（要求: ${recipe.arrangementRequest}）`}
        </p>
      )}

      {parent && (
        <p>
          <Link to={`/recipes/${parent.id}`}>親レシピ: {parent.title}</Link>
        </p>
      )}

      {recipe.description && (
        <p className="recipe-description">{recipe.description}</p>
      )}

      {recipe.safetyNotes.length > 0 && (
        <section className="notice notice-warning">
          <h2>安全上の注意</h2>
          <ul>
            {recipe.safetyNotes.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {recipe.changeSummary.length > 0 && (
        <section>
          <h2>主な変更点</h2>
          <ul>
            {recipe.changeSummary.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      <dl className="recipe-meta">
        {recipe.servings && (
          <>
            <dt>人数</dt>
            <dd>{recipe.servings}</dd>
          </>
        )}
        {recipe.cookingTimeMinutes != null && (
          <>
            <dt>調理時間</dt>
            <dd>{recipe.cookingTimeMinutes}分</dd>
          </>
        )}
        {recipe.category && (
          <>
            <dt>カテゴリ</dt>
            <dd>{recipe.category}</dd>
          </>
        )}
        {recipe.tags.length > 0 && (
          <>
            <dt>タグ</dt>
            <dd>{recipe.tags.join(", ")}</dd>
          </>
        )}
      </dl>

      <section>
        <h2>材料</h2>
        <ul className="ingredient-list">
          {recipe.ingredients.map((ing) => (
            <li key={ing.id}>
              {ing.name}
              {(ing.quantity || ing.unit) &&
                `：${ing.quantity ?? ""}${ing.unit ?? ""}`}
              {ing.note && `（${ing.note}）`}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>手順</h2>
        <ol className="step-list">
          {recipe.steps.map((step) => (
            <li key={step.id}>
              <StepText text={step.instruction} techniques={techniqueMap} />
            </li>
          ))}
        </ol>
      </section>

      {children.length > 0 && (
        <section>
          <h2>子レシピ</h2>
          <ul>
            {children.map((c) => (
              <li key={c.id}>
                <Link to={`/recipes/${c.id}`}>{c.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {deleteError && <p role="alert">{deleteError}</p>}

      <div className="detail-actions">
        <Link to={`/recipes/${recipe.id}/cook`} className="btn btn-primary">
          料理モード
        </Link>
        <Link to={`/recipes/${recipe.id}/arrange`} className="btn">
          アレンジする
        </Link>
        <Link to={`/recipes/${recipe.id}/edit`} className="btn">
          編集
        </Link>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => void handleDelete()}
          disabled={deleting}
        >
          {deleting ? "削除中..." : "削除"}
        </button>
      </div>
    </AppShell>
  );
}
