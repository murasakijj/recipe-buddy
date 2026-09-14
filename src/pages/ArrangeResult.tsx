import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import StepText from "../components/StepText";
import { useRecipes } from "../contexts/useRecipes";
import { useTechniques } from "../contexts/useTechniques";
import { clearArrangeSession, loadArrangeSession } from "../lib/arrangeSession";
import { newId } from "../lib/id";
import type { Technique } from "../lib/types";

export default function ArrangeResult() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { recipes, loading: recipesLoading, create } = useRecipes();
  const { techniques } = useTechniques();

  const recipe = id ? recipes.find((r) => r.id === id) : undefined;
  // sessionStorageの読み出しはレンダーのたびに行わず、idが変わったときだけにする。
  const session = useMemo(() => (id ? loadArrangeSession(id) : null), [id]);

  const techniqueMap = useMemo(() => {
    const map: Record<string, Technique> = {};
    techniques.forEach((t) => {
      map[t.id] = t;
    });
    return map;
  }, [techniques]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (!id) {
    return <Navigate to="/" replace />;
  }
  const recipeId = id;

  if (!session?.result) {
    return <Navigate to={`/recipes/${recipeId}/arrange`} replace />;
  }
  const result = session.result;
  const requestText = session.request;

  if (recipesLoading) {
    return (
      <AppShell>
        <p>読み込み中...</p>
      </AppShell>
    );
  }

  if (!recipe) {
    return (
      <AppShell>
        <p>レシピが見つかりません。</p>
      </AppShell>
    );
  }

  async function handleSaveAsChild() {
    if (!recipe) return;
    const name = window.prompt("保存する名前を入力してください", result.title);
    if (name === null) return; // キャンセル
    const title = name.trim().length > 0 ? name.trim() : result.title;

    setSaving(true);
    setSaveError(null);
    try {
      // 親子は1階層のみ(docs/decisions.md)。子からアレンジした場合も親はルートにする。
      const parentId = recipe.parentRecipeId ?? recipe.id;
      const created = await create({
        title,
        description: recipe.description,
        servings: recipe.servings,
        cookingTimeMinutes: recipe.cookingTimeMinutes,
        parentRecipeId: parentId,
        sourceType: "ai_arranged",
        arrangementRequest: requestText,
        category: recipe.category,
        tags: recipe.tags,
        imageUrl: null,
        safetyNotes: result.safetyNotes,
        changeSummary: result.changeSummary,
        ingredients: result.ingredients.map((ing) => ({
          id: newId(),
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          note: ing.note,
        })),
        steps: result.steps.map((s) => ({
          id: newId(),
          instruction: s.instruction,
        })),
      });
      clearArrangeSession(recipeId);
      navigate(`/recipes/${created.id}`);
    } catch {
      setSaveError("保存に失敗しました。");
      setSaving(false);
    }
  }

  function handleCookNow() {
    navigate(`/recipes/${recipeId}/arrange/cook`);
  }

  function handleRegenerate() {
    // 要求文はセッションに残したまま入力画面へ戻る。
    navigate(`/recipes/${recipeId}/arrange`);
  }

  function handleCancel() {
    if (!window.confirm("生成したアレンジを破棄しますか？")) return;
    clearArrangeSession(recipeId);
    navigate(`/recipes/${recipeId}`);
  }

  return (
    <AppShell>
      <h1>{recipe.title} のアレンジ結果</h1>
      <p className="notice">AIが生成した内容です。内容を確認してください。</p>

      {result.changeSummary.length > 0 && (
        <section>
          <h2>主な変更点</h2>
          <ul>
            {result.changeSummary.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {result.safetyNotes.length > 0 && (
        <section className="notice notice-warning">
          <h2>安全上の注意</h2>
          <ul>
            {result.safetyNotes.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {result.questions.length > 0 && (
        <section className="notice notice-warning">
          <h2>確認事項</h2>
          <ul>
            {result.questions.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      {result.newTechniqueCandidates.length > 0 && (
        <section>
          <h2>新規テクニック候補</h2>
          <ul>
            {result.newTechniqueCandidates.map((c, i) => (
              <li key={i}>
                <strong>{c.name}</strong>：{c.description}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>材料</h2>
        <ul className="ingredient-list">
          {result.ingredients.map((ing, i) => (
            <li key={i}>
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
          {result.steps.map((step, i) => (
            <li key={i}>
              <StepText text={step.instruction} techniques={techniqueMap} />
            </li>
          ))}
        </ol>
      </section>

      {saveError && (
        <p className="field-error" role="alert">
          {saveError}
        </p>
      )}

      <div className="detail-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCookNow}
        >
          今回だけ料理する
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void handleSaveAsChild()}
          disabled={saving}
        >
          {saving ? "保存中..." : "子レシピとして保存"}
        </button>
        <button type="button" className="btn" onClick={handleRegenerate}>
          要求を修正して再生成
        </button>
        <button type="button" className="btn btn-danger" onClick={handleCancel}>
          キャンセル
        </button>
      </div>
    </AppShell>
  );
}
