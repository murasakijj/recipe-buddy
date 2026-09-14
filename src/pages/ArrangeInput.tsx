import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useRecipes } from "../contexts/useRecipes";
import { useTechniques } from "../contexts/useTechniques";
import { requestArrangement } from "../lib/arrangeClient";
import { loadArrangeSession, saveArrangeSession } from "../lib/arrangeSession";
import { ApiError } from "../lib/apiClient";
import { stripMarkers } from "../lib/techniqueMarkup";

const ERROR_MESSAGES: Record<string, string> = {
  empty_request: "今日の状況を入力してください。",
  invalid_body: "入力内容を確認してください。",
  rate_limited:
    "リクエストが混み合っています。しばらくしてから再試行してください。",
  invalid_ai_output:
    "AIの応答を処理できませんでした。もう一度試すか、内容を変えて再試行してください。",
  upstream_error:
    "AIサービスに接続できませんでした。しばらくしてから再試行してください。",
  internal_error:
    "一時的な問題が発生しました。しばらくしてから再試行してください。",
  network:
    "通信エラーが発生しました。ネットワーク状況を確認して再試行してください。",
  missing_token: "認証が必要です。再度ログインしてください。",
  invalid_token: "認証が必要です。再度ログインしてください。",
  forbidden: "アクセス権がありません。",
  not_authenticated: "ログインしてください。",
};

/** ERROR_MESSAGESに無いコード用の汎用メッセージ。ネットワーク断とは区別する。 */
const GENERIC_ERROR_MESSAGE = "生成に失敗しました。再試行してください。";

function errorMessageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? GENERIC_ERROR_MESSAGE;
}

const REQUEST_MAX_LENGTH = 2000;

export default function ArrangeInput() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { recipes, loading: recipesLoading } = useRecipes();
  const { techniques } = useTechniques();

  const recipe = id ? recipes.find((r) => r.id === id) : undefined;

  const [request, setRequest] = useState(() =>
    id ? (loadArrangeSession(id)?.request ?? "") : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  if (!id) {
    return <Navigate to="/" replace />;
  }

  async function submit(
    currentId: string,
    currentRecipe: NonNullable<typeof recipe>,
  ) {
    const trimmed = request.trim();
    if (trimmed.length === 0) {
      setErrorCode("empty_request");
      return;
    }

    setSubmitting(true);
    setErrorCode(null);
    try {
      const result = await requestArrangement(
        {
          title: currentRecipe.title,
          description: currentRecipe.description,
          servings: currentRecipe.servings,
          cookingTimeMinutes: currentRecipe.cookingTimeMinutes,
          ingredients: currentRecipe.ingredients,
          steps: currentRecipe.steps,
        },
        techniques.map((t) => ({ id: t.id, name: t.name, summary: t.summary })),
        trimmed,
      );
      saveArrangeSession({
        parentRecipeId: currentId,
        request: trimmed,
        result,
        createdAt: new Date().toISOString(),
      });
      navigate(`/recipes/${currentId}/arrange/result`);
    } catch (err) {
      // 失敗しても要求文は保持する(FR-09 / SC-04)。
      // 以前に成功した result があれば消さずに残す(M-5): 再生成に失敗しても
      // 前回の結果ページ(アレンジ結果)へは引き続き戻れるようにする。
      const previous = loadArrangeSession(currentId);
      saveArrangeSession({
        parentRecipeId: currentId,
        request: trimmed,
        result: previous?.result ?? null,
        createdAt: previous?.createdAt ?? new Date().toISOString(),
      });
      setErrorCode(err instanceof ApiError ? err.message : "network");
      setSubmitting(false);
    }
  }

  function handleCancel() {
    navigate(`/recipes/${id}`);
  }

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

  const errorMessage = errorCode ? errorMessageFor(errorCode) : null;

  return (
    <AppShell>
      <h1>アレンジする</h1>
      <p className="arrange-target-title">{recipe.title}</p>

      <details className="arrange-summary">
        <summary>材料・手順を確認</summary>
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
        <ol className="step-list">
          {recipe.steps.map((step) => (
            <li key={step.id}>{stripMarkers(step.instruction)}</li>
          ))}
        </ol>
      </details>

      <form
        className="form"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (submitting) return;
          void submit(id, recipe);
        }}
      >
        <div className="form-field">
          <label htmlFor="arrange-request">今日の状況</label>
          <textarea
            id="arrange-request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="例: 玉ねぎがない。人参ならある。豚肉は冷凍で固まっていて、1枚ずつ剥がれない。"
            rows={5}
            maxLength={REQUEST_MAX_LENGTH}
            disabled={submitting}
          />
          <p className="char-counter">
            {request.length} / {REQUEST_MAX_LENGTH}
          </p>
        </div>

        {errorMessage && (
          <p className="field-error" role="alert">
            {errorMessage}
          </p>
        )}

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
          >
            {submitting ? "生成中…" : "生成する"}
          </button>
          {errorCode && !submitting && (
            <button
              type="button"
              className="btn"
              onClick={() => void submit(id, recipe)}
            >
              再試行
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={handleCancel}
            disabled={submitting}
          >
            キャンセル
          </button>
        </div>
      </form>
    </AppShell>
  );
}
