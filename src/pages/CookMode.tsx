import { useMemo, type ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import StepText from "../components/StepText";
import { useWakeLock } from "../hooks/useWakeLock";
import { useRecipes } from "../contexts/useRecipes";
import { useTechniques } from "../contexts/useTechniques";
import { loadArrangeSession } from "../lib/arrangeSession";
import type { WakeLockStatus } from "../lib/wakeLock";
import type { Technique } from "../lib/types";

interface CookModeProps {
  /** true: /recipes/:id/arrange/cook (一時アレンジ)。false: /recipes/:id/cook (保存済みレシピ)。 */
  temporary?: boolean;
}

interface DisplayIngredient {
  name: string;
  quantity: string | null;
  unit: string | null;
  note: string | null;
}

interface DisplayStep {
  instruction: string;
}

function wakeLockStatusText(status: WakeLockStatus): string {
  switch (status) {
    case "pending":
      return "画面消灯の抑止を準備中…";
    case "active":
      return "画面消灯を抑止中";
    case "unsupported":
      return "この端末では抑止できません";
    case "released":
      return "抑止が解除されました(タップで再取得)";
    case "failed":
      return "抑止に失敗しました(タップで再取得)";
    default:
      return "";
  }
}

function CookModeView({
  title,
  ingredients,
  steps,
  techniques,
  safetyNotes,
  changeSummary,
  wakeLockStatus,
  onReacquire,
  onExit,
}: {
  title: string;
  ingredients: DisplayIngredient[];
  steps: DisplayStep[];
  techniques: Record<string, Technique>;
  safetyNotes: string[];
  changeSummary: string[];
  wakeLockStatus: WakeLockStatus;
  onReacquire: () => void;
  onExit: () => void;
}): ReactNode {
  const statusText = wakeLockStatusText(wakeLockStatus);
  const canReacquire =
    wakeLockStatus === "released" || wakeLockStatus === "failed";

  return (
    <div className="cook-mode">
      <div className="cook-mode-status">
        {canReacquire ? (
          <button
            type="button"
            className="btn cook-mode-status-btn"
            onClick={onReacquire}
          >
            {statusText}
          </button>
        ) : (
          <p>{statusText}</p>
        )}
      </div>

      <div className="cook-mode-body">
        <h1>{title}</h1>

        {safetyNotes.length > 0 && (
          <section className="notice notice-warning">
            <h2>安全上の注意</h2>
            <ul>
              {safetyNotes.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        {changeSummary.length > 0 && (
          <section>
            <h2>主な変更点</h2>
            <ul>
              {changeSummary.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2>材料</h2>
          <ul className="ingredient-list cook-mode-ingredients">
            {ingredients.map((ing, i) => (
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
          <ol className="step-list cook-mode-steps">
            {steps.map((step, i) => (
              <li key={i}>
                <StepText text={step.instruction} techniques={techniques} />
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="cook-mode-footer">
        <button
          type="button"
          className="btn btn-primary cook-mode-exit"
          onClick={onExit}
        >
          料理モードを終了
        </button>
      </div>
    </div>
  );
}

export default function CookMode({ temporary = false }: CookModeProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { recipes, loading: recipesLoading } = useRecipes();
  const { techniques } = useTechniques();

  // sessionStorageの読み出しはレンダーのたびに行わず、id/temporaryが変わったときだけにする。
  const session = useMemo(
    () => (temporary && id ? loadArrangeSession(id) : null),
    [temporary, id],
  );
  const recipe =
    !temporary && id ? recipes.find((r) => r.id === id) : undefined;

  // 実際に表示するレシピ・アレンジ結果が無い(読み込み中・見つからない・
  // リダイレクト対象)間はWake Lockを保持しない。
  const hasContent = temporary ? Boolean(session?.result) : Boolean(recipe);
  const { status, reacquire } = useWakeLock(hasContent);

  const techniqueMap = useMemo(() => {
    const map: Record<string, Technique> = {};
    techniques.forEach((t) => {
      map[t.id] = t;
    });
    return map;
  }, [techniques]);

  if (!id) {
    return <Navigate to="/" replace />;
  }

  if (temporary) {
    if (!session?.result) {
      return <Navigate to={`/recipes/${id}/arrange`} replace />;
    }
    return (
      <CookModeView
        title={session.result.title}
        ingredients={session.result.ingredients}
        steps={session.result.steps}
        techniques={techniqueMap}
        safetyNotes={session.result.safetyNotes}
        changeSummary={session.result.changeSummary}
        wakeLockStatus={status}
        onReacquire={reacquire}
        onExit={() => navigate(`/recipes/${id}/arrange/result`)}
      />
    );
  }

  if (recipesLoading) {
    return (
      <main className="cook-mode">
        <p>読み込み中...</p>
      </main>
    );
  }

  if (!recipe) {
    return (
      <main className="cook-mode">
        <p>レシピが見つかりません。</p>
      </main>
    );
  }

  return (
    <CookModeView
      title={recipe.title}
      ingredients={recipe.ingredients}
      steps={recipe.steps}
      techniques={techniqueMap}
      safetyNotes={recipe.safetyNotes}
      changeSummary={recipe.changeSummary}
      wakeLockStatus={status}
      onReacquire={reacquire}
      onExit={() => navigate(`/recipes/${id}`)}
    />
  );
}
