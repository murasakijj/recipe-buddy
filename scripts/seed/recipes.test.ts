import { describe, it, expect } from "vitest";
import { validateRecipeInput } from "../../src/lib/recipeValidation";
import type { RecipeInput } from "../../src/lib/types";
import recipesJson from "./recipes.json";

/**
 * scripts/seed/recipes.json は手動で書き起こしたインポート用データ
 * (recipe/*.md → Firestore への一回限りの移行)。アプリのビルドには
 * 含まれないが、`src/lib/recipeValidation.ts` の必須項目チェックに
 * ちゃんと通ることだけはここで確認する。
 */

interface SeedIngredient {
  name: string;
  quantity: string | null;
  unit: string | null;
  note: string | null;
}

interface SeedStep {
  instruction: string;
}

interface SeedRecipe {
  importKey: string;
  title: string;
  description: string | null;
  servings: string | null;
  cookingTimeMinutes: number | null;
  category: string | null;
  tags: string[];
  ingredients: SeedIngredient[];
  steps: SeedStep[];
}

const recipes = recipesJson as SeedRecipe[];

/** import-recipes.mjs が書き込み時に付ける固定フィールドを補い、RecipeInput相当にする。 */
function toRecipeInput(seed: SeedRecipe): RecipeInput {
  return {
    title: seed.title,
    description: seed.description,
    servings: seed.servings,
    cookingTimeMinutes: seed.cookingTimeMinutes,
    parentRecipeId: null,
    sourceType: "manual",
    arrangementRequest: null,
    category: seed.category,
    tags: seed.tags,
    imageUrl: null,
    safetyNotes: [],
    changeSummary: [],
    ingredients: seed.ingredients.map((ing, i) => ({
      id: `seed-ingredient-${i}`,
      ...ing,
    })),
    steps: seed.steps.map((step, i) => ({
      id: `seed-step-${i}`,
      ...step,
    })),
  };
}

describe("scripts/seed/recipes.json", () => {
  it("13件のレシピが揃っている(09-06:6 / 09-09:4 / 09-14:3)", () => {
    expect(recipes).toHaveLength(13);
  });

  it("importKeyが一意である", () => {
    const keys = recipes.map((r) => r.importKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(recipes.map((r) => [r.importKey, r] as const))(
    "%s: validateRecipeInputでエラーが無い",
    (_key, recipe) => {
      const errors = validateRecipeInput(toRecipeInput(recipe));
      expect(errors).toEqual({});
    },
  );

  it("すべてtitleが空でない", () => {
    recipes.forEach((r) => {
      expect(r.title.trim().length).toBeGreaterThan(0);
    });
  });

  it("すべて材料が1件以上、手順が1件以上ある", () => {
    recipes.forEach((r) => {
      expect(r.ingredients.length).toBeGreaterThan(0);
      expect(r.steps.length).toBeGreaterThan(0);
    });
  });

  it("すべてtagsに記録日が1件入っている", () => {
    recipes.forEach((r) => {
      expect(r.tags.length).toBe(1);
      expect(r.tags[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
