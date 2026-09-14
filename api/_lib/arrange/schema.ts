import { z } from "zod";

/**
 * POST /api/arrange のリクエスト/レスポンスのzodスキーマ(docs/api.md)。
 * src/lib/types.ts の ArrangedRecipe と形は同じだが、api/ と src/ の間では
 * importしない方針のためここに独立して定義する。
 */

// 文字数上限は docs/api.md の指定に合わせる。
const ingredientInputSchema = z.object({
  name: z.string().max(100),
  quantity: z.string().max(100).nullable().optional(),
  unit: z.string().max(100).nullable().optional(),
  note: z.string().max(100).nullable().optional(),
});

const stepInputSchema = z.object({
  instruction: z.string().max(2000),
});

const techniqueRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(100),
  summary: z.string().max(500).nullable().optional(),
});

const arrangeRecipeSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(2000).nullable().optional(),
  servings: z.string().nullable().optional(),
  cookingTimeMinutes: z.number().nullable().optional(),
  ingredients: z.array(ingredientInputSchema).min(1).max(100),
  steps: z.array(stepInputSchema).min(1).max(100),
});

export const arrangeRequestSchema = z.object({
  recipe: arrangeRecipeSchema,
  request: z.string().min(1).max(2000),
  techniques: z.array(techniqueRefSchema).max(500),
});

export type ArrangeRequestBody = z.infer<typeof arrangeRequestSchema>;

// --- AI出力側 ---

// Geminiが quantity/unit を数値として返すことがあるため、数値も許容して文字列化する。
const stringOrNumber = z.union([z.string(), z.number().transform(String)]);
const nullableStringOrNumber = stringOrNumber.nullable().optional();

const arrangedIngredientRawSchema = z.object({
  name: z.string(),
  quantity: nullableStringOrNumber,
  unit: nullableStringOrNumber,
  note: z.string().nullable().optional(),
});

const arrangedStepRawSchema = z.object({
  instruction: z.string(),
});

const newTechniqueCandidateRawSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const arrangedRecipeSchema = z.object({
  title: z.string(),
  changeSummary: z.array(z.string()).default([]),
  ingredients: z.array(arrangedIngredientRawSchema),
  steps: z.array(arrangedStepRawSchema),
  safetyNotes: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  newTechniqueCandidates: z.array(newTechniqueCandidateRawSchema).default([]),
});

export type ArrangedRecipeRaw = z.infer<typeof arrangedRecipeSchema>;

export interface ArrangedIngredient {
  name: string;
  quantity: string | null;
  unit: string | null;
  note: string | null;
}

export interface ArrangedStep {
  instruction: string;
}

export interface ArrangedRecipe {
  title: string;
  changeSummary: string[];
  ingredients: ArrangedIngredient[];
  steps: ArrangedStep[];
  safetyNotes: string[];
  questions: string[];
  newTechniqueCandidates: { name: string; description: string }[];
}

// src/lib/techniqueMarkup.ts の parseInstruction と同じ意味論の小さな正規表現。
// api/ と src/ の間でimportしない方針のためここに複製する。
const MARKER_RE = /\[\[([^[\]]*)\]\]/g;

/**
 * 本文中の `[[id|語句]]` マーカーのうち、id が knownIds に含まれないものを
 * 語句(表示テキスト)だけのプレーンテキストに書き換える。
 * 壊れたマーカー(`|`が無い、id/語句が空など)は素通しする(そもそも記法として解釈しない)。
 */
export function stripUnknownTechniqueMarkers(
  text: string,
  knownIds: Set<string>,
): string {
  return text.replace(MARKER_RE, (full, inner: string) => {
    const sepIndex = inner.indexOf("|");
    if (sepIndex <= 0) return full;
    const id = inner.slice(0, sepIndex).trim();
    const displayText = inner.slice(sepIndex + 1);
    if (id.length === 0 || displayText.length === 0) return full;
    if (knownIds.has(id)) return full;
    return displayText;
  });
}

function normalizeNullableString(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * AI出力をサニタイズし、保存・表示可能な ArrangedRecipe に整形する。
 * - 文字列をtrim(titleが空ならエラーにせず `${fallbackTitle}（アレンジ）` を使う)
 * - 名前/本文が空の材料・手順を除去
 * - 存在しないtechniqueIdへの参照は語句だけに書き換える
 * - 材料・手順が結果的に0件になったら例外を投げる(呼び出し側で 502 invalid_ai_output に変換する)
 */
export function sanitizeArrangedRecipe(
  result: ArrangedRecipeRaw,
  knownTechniqueIds: Set<string>,
  fallbackTitle: string,
): ArrangedRecipe {
  const trimmedTitle = result.title.trim();
  const title =
    trimmedTitle.length > 0 ? trimmedTitle : `${fallbackTitle}（アレンジ）`;

  const ingredients = result.ingredients
    .map((ing) => ({
      name: ing.name.trim(),
      quantity: normalizeNullableString(ing.quantity),
      unit: normalizeNullableString(ing.unit),
      note: normalizeNullableString(ing.note),
    }))
    .filter((ing) => ing.name.length > 0);
  if (ingredients.length === 0) {
    throw new Error("empty_ingredients");
  }

  const steps = result.steps
    .map((step) => ({
      instruction: stripUnknownTechniqueMarkers(
        step.instruction,
        knownTechniqueIds,
      ).trim(),
    }))
    .filter((step) => step.instruction.length > 0);
  if (steps.length === 0) {
    throw new Error("empty_steps");
  }

  return {
    title,
    changeSummary: result.changeSummary
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    ingredients,
    steps,
    safetyNotes: result.safetyNotes
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    questions: result.questions
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    newTechniqueCandidates: result.newTechniqueCandidates
      .map((c) => ({ name: c.name.trim(), description: c.description.trim() }))
      .filter((c) => c.name.length > 0 && c.description.length > 0),
  };
}
