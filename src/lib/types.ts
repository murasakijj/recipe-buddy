export type SourceType = "manual" | "ai_arranged";

export interface Ingredient {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  note: string | null;
}

export interface Step {
  id: string;
  instruction: string;
  techniqueIds: string[];
}

export interface Recipe {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  cookingTimeMinutes: number | null;
  parentRecipeId: string | null;
  sourceType: SourceType;
  arrangementRequest: string | null;
  category: string | null;
  tags: string[];
  imageUrl: string | null;
  /** AIアレンジ保存時の安全上の注意(manual は常に [])。 */
  safetyNotes: string[];
  /** AIアレンジ保存時の主な変更点(manual は常に [])。 */
  changeSummary: string[];
  ingredients: Ingredient[];
  steps: Step[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface Technique {
  id: string;
  name: string;
  summary: string | null;
  instructions: string[];
  cautions: string | null;
  media: null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** 新規作成・更新用の入力材料行。id はクライアントで採番済み。 */
export interface IngredientInput {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  note: string | null;
}

/** 新規作成・更新用の入力手順行。id はクライアントで採番済み。techniqueIds は本文から再計算する。 */
export interface StepInput {
  id: string;
  instruction: string;
}

export interface RecipeInput {
  title: string;
  description: string | null;
  servings: string | null;
  cookingTimeMinutes: number | null;
  parentRecipeId: string | null;
  sourceType: SourceType;
  arrangementRequest: string | null;
  category: string | null;
  tags: string[];
  imageUrl: string | null;
  safetyNotes: string[];
  changeSummary: string[];
  ingredients: IngredientInput[];
  steps: StepInput[];
}

export interface TechniqueInput {
  name: string;
  summary: string | null;
  instructions: string[];
  cautions: string | null;
}

// --- AIアレンジ(docs/api.md ArrangedRecipe / docs/data-model.md 一時アレンジ) ---

/** AIアレンジ結果の材料行。保存済みIngredientと異なり id を持たない。 */
export interface ArrangedIngredient {
  name: string;
  quantity: string | null;
  unit: string | null;
  note: string | null;
}

/** AIアレンジ結果の手順行。保存済みStepと異なり id/techniqueIds を持たない。 */
export interface ArrangedStep {
  instruction: string;
}

export interface NewTechniqueCandidate {
  name: string;
  description: string;
}

/** POST /api/arrange のレスポンス(docs/api.md)。 */
export interface ArrangedRecipe {
  title: string;
  changeSummary: string[];
  ingredients: ArrangedIngredient[];
  steps: ArrangedStep[];
  safetyNotes: string[];
  questions: string[];
  newTechniqueCandidates: NewTechniqueCandidate[];
}

/**
 * 保存前の一時アレンジ(docs/data-model.md §一時アレンジ)。
 * sessionStorage キー `arrange:{parentRecipeId}` に保持する。
 */
export interface ArrangeSession {
  parentRecipeId: string;
  request: string;
  result: ArrangedRecipe | null;
  createdAt: string; // ISO 8601
}
