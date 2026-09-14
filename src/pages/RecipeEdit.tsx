import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import TechniquePickerDialog from "../components/TechniquePickerDialog";
import { useRecipes } from "../contexts/useRecipes";
import { useTechniques } from "../contexts/useTechniques";
import { newId } from "../lib/id";
import { validateRecipeInput } from "../lib/recipeValidation";
import { wrapSelection } from "../lib/techniqueMarkup";
import type {
  IngredientInput,
  RecipeInput,
  SourceType,
  StepInput,
} from "../lib/types";

function emptyIngredient(): IngredientInput {
  return { id: newId(), name: "", quantity: null, unit: null, note: null };
}

function emptyStep(): StepInput {
  return { id: newId(), instruction: "" };
}

function trimOrNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function RecipeEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    recipes,
    loading: recipesLoading,
    error: recipesError,
    reload,
    create,
    update,
  } = useRecipes();
  const { techniques } = useTechniques();
  const isEditing = Boolean(id);
  const existing = id ? recipes.find((r) => r.id === id) : undefined;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [servings, setServings] = useState("");
  const [cookingTimeInput, setCookingTimeInput] = useState("");
  const [category, setCategory] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [ingredients, setIngredients] = useState<IngredientInput[]>([
    emptyIngredient(),
  ]);
  const [steps, setSteps] = useState<StepInput[]>([emptyStep()]);

  // 編集時のみ保持し、フォームには出さない値。
  const [parentRecipeId, setParentRecipeId] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>("manual");
  const [arrangementRequest, setArrangementRequest] = useState<string | null>(
    null,
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // AIアレンジ由来の付加情報。編集画面では表示・編集対象にせず、既存値をそのまま保持する
  // (docs/data-model.md「AIアレンジ由来の付加情報」)。
  const [safetyNotes, setSafetyNotes] = useState<string[]>([]);
  const [changeSummary, setChangeSummary] = useState<string[]>([]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 手順id → メッセージ。行の並び替え・削除をしても別の行に付け替わらないよう
  // 配列インデックスではなく各行の id をキーにする。
  const [linkMessages, setLinkMessages] = useState<Record<string, string>>({});
  const [pickerStepId, setPickerStepId] = useState<string | null>(null);
  const [pickerSelection, setPickerSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  // ピッカーを開いたテキストエリア要素(renderでref.currentを読まないようstateで持つ)。
  const [pickerOpenerEl, setPickerOpenerEl] =
    useState<HTMLTextAreaElement | null>(null);

  // 手順id → テキストエリアDOM要素。
  const stepTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>(
    {},
  );
  // 手順id → 直近の非空選択範囲。iOS Safariは「テクニックを紐づけ」ボタン押下で
  // テキストエリアがblurすると selectionStart/End をリセットしてしまうため、
  // blurする前の onSelect/onKeyUp/onMouseUp/onTouchEnd で保存しておく。
  const selectionRef = useRef<Record<string, { start: number; end: number }>>(
    {},
  );
  // マーカー挿入後、DOM更新後にキャレットを挿入直後へ移動するための予約。
  const pendingCaretRef = useRef<{ stepId: string; position: number } | null>(
    null,
  );

  // 既存レシピの読み込みが完了した(またはidが変わった)タイミングでフォームへ反映する。
  // useEffectではなく「レンダー中に条件付きでstateを更新する」パターンを使い、
  // existing.id が変わったときだけ1回だけ反映する(無限ループにはならない)。
  const [hydratedId, setHydratedId] = useState<string | undefined>(undefined);
  if (existing && hydratedId !== existing.id) {
    setHydratedId(existing.id);
    setTitle(existing.title);
    setDescription(existing.description ?? "");
    setServings(existing.servings ?? "");
    setCookingTimeInput(
      existing.cookingTimeMinutes != null
        ? String(existing.cookingTimeMinutes)
        : "",
    );
    setCategory(existing.category ?? "");
    setTagsInput(existing.tags.join(", "));
    setIngredients(
      existing.ingredients.length > 0
        ? existing.ingredients.map((i) => ({ ...i }))
        : [emptyIngredient()],
    );
    setSteps(
      existing.steps.length > 0
        ? existing.steps.map((s) => ({ id: s.id, instruction: s.instruction }))
        : [emptyStep()],
    );
    setParentRecipeId(existing.parentRecipeId);
    setSourceType(existing.sourceType);
    setArrangementRequest(existing.arrangementRequest);
    setImageUrl(existing.imageUrl);
    setSafetyNotes(existing.safetyNotes);
    setChangeSummary(existing.changeSummary);
  }

  // マーカー挿入後のキャレット移動。effect本体では直接setStateせず、
  // refを読んで消費するだけ(依存配列なし = 毎レンダー後にチェックする軽い処理)。
  useEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending) return;
    pendingCaretRef.current = null;
    const el = stepTextareaRefs.current[pending.stepId];
    if (el) {
      el.focus();
      el.setSelectionRange(pending.position, pending.position);
    }
  });

  function clearErrorKey(key: string) {
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // --- 材料行の操作 ---
  function updateIngredient(index: number, patch: Partial<IngredientInput>) {
    setIngredients((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }
  function addIngredient() {
    setIngredients((prev) => [...prev, emptyIngredient()]);
  }
  function removeIngredient(index: number) {
    const removedId = ingredients[index]?.id;
    setIngredients((prev) => prev.filter((_, i) => i !== index));
    if (removedId) {
      clearErrorKey(`ingredients.${removedId}.name`);
    }
  }
  function moveIngredient(index: number, dir: -1 | 1) {
    setIngredients((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // --- 手順行の操作 ---
  function updateStepInstruction(index: number, instruction: string) {
    setSteps((prev) =>
      prev.map((row, i) => (i === index ? { ...row, instruction } : row)),
    );
    // 本文が変わったら、保存していた選択範囲のオフセットは古くなるので捨てる
    // (テキスト編集で文字位置がずれた状態のまま再利用しないように)。
    const stepId = steps[index]?.id;
    if (stepId) {
      delete selectionRef.current[stepId];
    }
  }
  function addStep() {
    setSteps((prev) => [...prev, emptyStep()]);
  }
  function removeStep(index: number) {
    const removedId = steps[index]?.id;
    setSteps((prev) => prev.filter((_, i) => i !== index));
    if (removedId) {
      setLinkMessages((prev) => {
        if (!(removedId in prev)) return prev;
        const next = { ...prev };
        delete next[removedId];
        return next;
      });
      clearErrorKey(`steps.${removedId}.instruction`);
      delete stepTextareaRefs.current[removedId];
      delete selectionRef.current[removedId];
    }
  }
  function moveStep(index: number, dir: -1 | 1) {
    setSteps((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function trackSelection(stepId: string, el: HTMLTextAreaElement) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start !== end) {
      selectionRef.current[stepId] = { start, end };
    }
  }

  function handleLinkClick(stepId: string) {
    const el = stepTextareaRefs.current[stepId];
    const liveStart = el?.selectionStart ?? null;
    const liveEnd = el?.selectionEnd ?? null;
    const hasLiveSelection =
      liveStart !== null && liveEnd !== null && liveStart !== liveEnd;
    const saved = selectionRef.current[stepId];

    const start = hasLiveSelection ? liveStart : (saved?.start ?? null);
    const end = hasLiveSelection ? liveEnd : (saved?.end ?? null);

    if (start === null || end === null || start === end) {
      setLinkMessages((prev) => ({
        ...prev,
        [stepId]: "語句を選択してください",
      }));
      return;
    }
    setLinkMessages((prev) => ({ ...prev, [stepId]: "" }));
    setPickerSelection({ start, end });
    setPickerStepId(stepId);
    setPickerOpenerEl(el ?? null);
  }

  function handlePickTechnique(techniqueId: string) {
    if (pickerStepId === null || !pickerSelection) return;
    const stepId = pickerStepId;
    const { start, end } = pickerSelection;
    setPickerStepId(null);
    setPickerSelection(null);
    setPickerOpenerEl(null);

    const target = steps.find((s) => s.id === stepId);
    if (!target) return;

    const next = wrapSelection(target.instruction, start, end, techniqueId);
    if (next === target.instruction) {
      // 範囲外、または既存マーカーと重なっていて変更されなかった。
      setLinkMessages((prev) => ({
        ...prev,
        [stepId]: "既にテクニックが紐づいた範囲は選べません",
      }));
      return;
    }

    setLinkMessages((prev) => ({ ...prev, [stepId]: "" }));
    setSteps((prev) =>
      prev.map((row) =>
        row.id === stepId ? { ...row, instruction: next } : row,
      ),
    );
    // 挿入後は本文が変わっているので、古い選択範囲のオフセットを再利用しないよう捨てる。
    delete selectionRef.current[stepId];

    const insertedMarker = `[[${techniqueId}|${target.instruction.slice(start, end)}]]`;
    pendingCaretRef.current = {
      stepId,
      position: start + insertedMarker.length,
    };
  }

  function closePicker() {
    setPickerStepId(null);
    setPickerSelection(null);
    setPickerOpenerEl(null);
  }

  function buildInput(): RecipeInput {
    const cookingTimeMinutes =
      cookingTimeInput.trim() === "" ? null : Number(cookingTimeInput);
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const trimmedIngredients = ingredients.map((ing) => ({
      id: ing.id,
      name: ing.name.trim(),
      quantity: trimOrNull(ing.quantity),
      unit: trimOrNull(ing.unit),
      note: trimOrNull(ing.note),
    }));
    const trimmedSteps = steps.map((s) => ({
      id: s.id,
      instruction: s.instruction.trim(),
    }));
    return {
      title: title.trim(),
      description: description.trim().length > 0 ? description.trim() : null,
      servings: servings.trim().length > 0 ? servings.trim() : null,
      cookingTimeMinutes,
      parentRecipeId,
      sourceType,
      arrangementRequest,
      category: category.trim().length > 0 ? category.trim() : null,
      tags,
      imageUrl,
      safetyNotes,
      changeSummary,
      ingredients: trimmedIngredients,
      steps: trimmedSteps,
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const input = buildInput();
    const nextErrors = validateRecipeInput(input);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setSubmitError(null);
    try {
      if (id) {
        await update(id, input);
        navigate(`/recipes/${id}`);
      } else {
        const created = await create(input);
        navigate(`/recipes/${created.id}`);
      }
    } catch {
      setSubmitError("保存に失敗しました。入力内容は保持されています。");
      setSaving(false);
    }
  }

  function handleCancel() {
    navigate(id ? `/recipes/${id}` : "/");
  }

  if (isEditing) {
    if (recipesLoading) {
      return (
        <AppShell>
          <p>読み込み中...</p>
        </AppShell>
      );
    }
    if (recipesError) {
      return (
        <AppShell>
          <p role="alert">読み込みに失敗しました。</p>
          <button type="button" className="btn" onClick={() => void reload()}>
            再試行
          </button>
        </AppShell>
      );
    }
    if (!existing) {
      return (
        <AppShell>
          <p>レシピが見つかりません。</p>
        </AppShell>
      );
    }
  }

  return (
    <AppShell>
      <h1>{isEditing ? "レシピを編集" : "レシピを新規登録"}</h1>
      <form onSubmit={(e) => void handleSubmit(e)} className="form">
        <div className="form-field">
          <label htmlFor="recipe-title">レシピ名</label>
          <input
            id="recipe-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {errors.title && (
            <p className="field-error" role="alert">
              {errors.title}
            </p>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="recipe-description">概要・メモ</label>
          <textarea
            id="recipe-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="form-row">
          <div className="form-field">
            <label htmlFor="recipe-servings">人数</label>
            <input
              id="recipe-servings"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              placeholder="例: 2人分"
            />
          </div>
          <div className="form-field">
            <label htmlFor="recipe-cooking-time">調理時間（分）</label>
            <input
              id="recipe-cooking-time"
              type="number"
              min={0}
              step={1}
              value={cookingTimeInput}
              onChange={(e) => setCookingTimeInput(e.target.value)}
            />
            {errors.cookingTimeMinutes && (
              <p className="field-error" role="alert">
                {errors.cookingTimeMinutes}
              </p>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-field">
            <label htmlFor="recipe-category">カテゴリ</label>
            <input
              id="recipe-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="recipe-tags">タグ（カンマ区切り）</label>
            <input
              id="recipe-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="例: 和食, 時短"
            />
          </div>
        </div>

        <div className="form-field">
          <span>材料</span>
          {errors.ingredients && (
            <p className="field-error" role="alert">
              {errors.ingredients}
            </p>
          )}
          {ingredients.map((ingredient, i) => (
            <div key={ingredient.id} className="row-editor ingredient-row">
              <input
                value={ingredient.name}
                onChange={(e) => updateIngredient(i, { name: e.target.value })}
                placeholder="材料名"
                aria-label={`材料${i + 1}の名前`}
              />
              {errors[`ingredients.${ingredient.id}.name`] && (
                <p className="field-error" role="alert">
                  {errors[`ingredients.${ingredient.id}.name`]}
                </p>
              )}
              <input
                value={ingredient.quantity ?? ""}
                onChange={(e) =>
                  updateIngredient(i, {
                    quantity: e.target.value || null,
                  })
                }
                placeholder="分量"
                aria-label={`材料${i + 1}の分量`}
              />
              <input
                value={ingredient.unit ?? ""}
                onChange={(e) =>
                  updateIngredient(i, { unit: e.target.value || null })
                }
                placeholder="単位"
                aria-label={`材料${i + 1}の単位`}
              />
              <input
                value={ingredient.note ?? ""}
                onChange={(e) =>
                  updateIngredient(i, { note: e.target.value || null })
                }
                placeholder="補足"
                aria-label={`材料${i + 1}の補足`}
              />
              <div className="row-editor-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => moveIngredient(i, -1)}
                  disabled={i === 0}
                  aria-label="上へ移動"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => moveIngredient(i, 1)}
                  disabled={i === ingredients.length - 1}
                  aria-label="下へ移動"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => removeIngredient(i)}
                  disabled={ingredients.length <= 1}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="btn" onClick={addIngredient}>
            材料を追加
          </button>
        </div>

        <div className="form-field">
          <span>手順</span>
          {errors.steps && (
            <p className="field-error" role="alert">
              {errors.steps}
            </p>
          )}
          {steps.map((step, i) => (
            <div key={step.id} className="row-editor step-row">
              <textarea
                ref={(el) => {
                  stepTextareaRefs.current[step.id] = el;
                }}
                value={step.instruction}
                onChange={(e) => updateStepInstruction(i, e.target.value)}
                onSelect={(e) => trackSelection(step.id, e.currentTarget)}
                onKeyUp={(e) => trackSelection(step.id, e.currentTarget)}
                onMouseUp={(e) => trackSelection(step.id, e.currentTarget)}
                onTouchEnd={(e) => trackSelection(step.id, e.currentTarget)}
                onBlur={(e) => trackSelection(step.id, e.currentTarget)}
                aria-label={`手順${i + 1}`}
              />
              {errors[`steps.${step.id}.instruction`] && (
                <p className="field-error" role="alert">
                  {errors[`steps.${step.id}.instruction`]}
                </p>
              )}
              <div className="row-editor-actions">
                <button
                  type="button"
                  className="btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleLinkClick(step.id)}
                >
                  テクニックを紐づけ
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => moveStep(i, -1)}
                  disabled={i === 0}
                  aria-label="上へ移動"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => moveStep(i, 1)}
                  disabled={i === steps.length - 1}
                  aria-label="下へ移動"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => removeStep(i)}
                  disabled={steps.length <= 1}
                >
                  削除
                </button>
              </div>
              {linkMessages[step.id] && (
                <p className="field-error" role="alert">
                  {linkMessages[step.id]}
                </p>
              )}
            </div>
          ))}
          <button type="button" className="btn" onClick={addStep}>
            手順を追加
          </button>
        </div>

        {submitError && (
          <p className="field-error" role="alert">
            {submitError}
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </button>
          <button type="button" className="btn" onClick={handleCancel}>
            キャンセル
          </button>
        </div>
      </form>

      {pickerStepId !== null && (
        <TechniquePickerDialog
          techniques={techniques}
          onSelect={handlePickTechnique}
          onClose={closePicker}
          returnFocusTo={pickerOpenerEl}
        />
      )}
    </AppShell>
  );
}
