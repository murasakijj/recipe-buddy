import { z } from "zod";

/**
 * POST /api/import-classify のリクエスト/レスポンスのzodスキーマ(docs/api.md)。
 *
 * 2026-09-28: 「整形」(/api/import-normalize)と「分類」を2パスに分離した
 * (docs/decisions.md「整形と分類を2パスに分けた」)。分類は材料名・手順本文だけの
 * 軽い表現を受け取り、カテゴリ・タグ・人数・調理時間を推測して返す。
 */

const MAX_RECIPES = 20;
const MAX_TITLE_LENGTH = 200;
const MAX_INGREDIENT_LENGTH = 100;
const MAX_STEP_LENGTH = 500;
const MAX_INGREDIENTS_PER_RECIPE = 60;
const MAX_STEPS_PER_RECIPE = 60;

const classifyRecipeInputSchema = z.object({
  title: z.string().max(MAX_TITLE_LENGTH),
  ingredients: z.array(z.string().max(MAX_INGREDIENT_LENGTH)).max(MAX_INGREDIENTS_PER_RECIPE),
  steps: z.array(z.string().max(MAX_STEP_LENGTH)).max(MAX_STEPS_PER_RECIPE),
});

export type ClassifyRecipeInput = z.infer<typeof classifyRecipeInputSchema>;

export const importClassifyRequestSchema = z.object({
  recipes: z.array(classifyRecipeInputSchema).min(1).max(MAX_RECIPES),
});

export type ImportClassifyRequestBody = z.infer<typeof importClassifyRequestSchema>;

// --- AI出力側(生) ---

// Geminiがcookingtimeを数値/数値文字列どちらで返しても拾えるようにする(/api/arrangeと同じ方針)。
const numberOrNumericString = z.union([
  z.number(),
  z.string().transform((s) => Number(s)),
]);

const classifiedMetadataRawSchema = z.object({
  category: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  servings: z.string().nullable().optional(),
  cookingTimeMinutes: numberOrNumericString.nullable().optional(),
});

export const importClassifyResponseRawSchema = z.object({
  results: z.array(classifiedMetadataRawSchema),
});

export type ClassifiedMetadataRaw = z.infer<typeof classifiedMetadataRawSchema>;
export type ImportClassifyResponseRaw = z.infer<typeof importClassifyResponseRawSchema>;

// --- サニタイズ後の公開型 ---

export interface ClassifiedMetadata {
  category: string | null;
  tags: string[];
  servings: string | null;
  cookingTimeMinutes: number | null;
}

/**
 * カテゴリの語彙(docs/decisions.md「メタデータの自動補完」)。`RecipeList` の
 * カテゴリ絞り込み`<select>`は登録済みレシピから動的生成されるため、語彙外の値が
 * 紛れ込むと表記ゆれで選択肢が断片化する。分類は構造化出力なのでコードで語彙を
 * 機械的に強制できる(2パス化の利点)。
 */
export const CATEGORY_VOCABULARY = [
  "主菜",
  "副菜",
  "汁物",
  "主食",
  "丼",
  "デザート",
  "その他",
] as const;

/** タグの最大個数。 */
const MAX_TAGS = 5;

/**
 * AI出力1件を、保存可能な `ClassifiedMetadata` にサニタイズする。
 * - `category` は7種類の語彙外なら `null` にする(語彙外の値をそのまま保存しない)。
 * - `tags` は空文字除去・trim・重複除去のうえ最大5個に切り詰める。調理法の語彙外の
 *   タグ自体は落とさない(材料名などの自由なタグは許容する。落とすのは空文字・重複・
 *   5個超過分だけ)。
 * - `servings` は空文字なら `null`。
 * - `cookingTimeMinutes` は正の整数でなければ `null`。
 */
export function sanitizeClassifiedMetadata(
  raw: ClassifiedMetadataRaw,
): ClassifiedMetadata {
  const category =
    raw.category && (CATEGORY_VOCABULARY as readonly string[]).includes(raw.category)
      ? raw.category
      : null;

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const tag of raw.tags) {
    const trimmed = tag.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    tags.push(trimmed);
    if (tags.length >= MAX_TAGS) break;
  }

  const servingsTrimmed = raw.servings?.trim();
  const servings = servingsTrimmed && servingsTrimmed.length > 0 ? servingsTrimmed : null;

  const cookingTimeMinutes =
    typeof raw.cookingTimeMinutes === "number" &&
    Number.isInteger(raw.cookingTimeMinutes) &&
    raw.cookingTimeMinutes > 0
      ? raw.cookingTimeMinutes
      : null;

  return { category, tags, servings, cookingTimeMinutes };
}
