import type { ArrangedRecipe, ArrangeSession } from "./types";

/**
 * 保存前の一時アレンジを sessionStorage に保持する(docs/data-model.md §一時アレンジ)。
 * タブを閉じれば消える。保存操作を行った場合のみ Firestore へ永続化する。
 */

function storageKey(parentRecipeId: string): string {
  return `arrange:${parentRecipeId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 配列でなければ空配列にする(壊れた/古い形式のデータへの耐性)。 */
function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * result オブジェクトを検証・正規化する。title が文字列でなければ
 * 使い物にならないと判断して null を返す(呼び出し側でセッション全体を破棄する)。
 * 配列フィールドは欠けていても [] に丸める。
 */
function normalizeArrangedRecipe(value: unknown): ArrangedRecipe | null {
  if (!isRecord(value)) return null;
  if (typeof value.title !== "string") return null;
  return {
    title: value.title,
    ingredients: toArray<ArrangedRecipe["ingredients"][number]>(
      value.ingredients,
    ),
    steps: toArray<ArrangedRecipe["steps"][number]>(value.steps),
    changeSummary: toArray<string>(value.changeSummary),
    safetyNotes: toArray<string>(value.safetyNotes),
    questions: toArray<string>(value.questions),
    newTechniqueCandidates: toArray<
      ArrangedRecipe["newTechniqueCandidates"][number]
    >(value.newTechniqueCandidates),
  };
}

/**
 * sessionStorageから読み出した生の値を検証・正規化する。
 * parentRecipeId/request/createdAt は文字列必須。result は null か、
 * normalizeArrangedRecipe で正規化できるオブジェクトのみ許容する。
 * 形が使い物にならない場合は null を返す(呼び出し側は「セッション無し」として扱う)。
 */
function normalizeSession(value: unknown): ArrangeSession | null {
  if (!isRecord(value)) return null;

  const { parentRecipeId, request, createdAt, result } = value;
  if (
    typeof parentRecipeId !== "string" ||
    typeof request !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }

  if (result === null) {
    return { parentRecipeId, request, createdAt, result: null };
  }
  const normalizedResult = normalizeArrangedRecipe(result);
  if (!normalizedResult) return null;

  return { parentRecipeId, request, createdAt, result: normalizedResult };
}

export function loadArrangeSession(
  parentRecipeId: string,
): ArrangeSession | null {
  try {
    const raw = sessionStorage.getItem(storageKey(parentRecipeId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return normalizeSession(parsed);
  } catch {
    return null;
  }
}

export function saveArrangeSession(session: ArrangeSession): void {
  try {
    sessionStorage.setItem(
      storageKey(session.parentRecipeId),
      JSON.stringify(session),
    );
  } catch {
    // sessionStorageが使えない環境(プライベートブラウズ等)では諦める。
  }
}

export function clearArrangeSession(parentRecipeId: string): void {
  try {
    sessionStorage.removeItem(storageKey(parentRecipeId));
  } catch {
    // noop
  }
}
