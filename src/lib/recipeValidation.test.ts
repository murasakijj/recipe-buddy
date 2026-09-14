import { describe, it, expect } from "vitest";
import { validateRecipeInput } from "./recipeValidation";
import type { RecipeInput } from "./types";

function baseInput(overrides: Partial<RecipeInput> = {}): RecipeInput {
  return {
    title: "鮭のホイル焼き",
    description: null,
    servings: "2",
    cookingTimeMinutes: 25,
    parentRecipeId: null,
    sourceType: "manual",
    arrangementRequest: null,
    category: null,
    tags: [],
    imageUrl: null,
    safetyNotes: [],
    changeSummary: [],
    ingredients: [
      { id: "i1", name: "鮭", quantity: "2", unit: "切れ", note: null },
    ],
    steps: [{ id: "s1", instruction: "焼く。" }],
    ...overrides,
  };
}

describe("validateRecipeInput", () => {
  it("有効な入力ならエラー無し", () => {
    expect(validateRecipeInput(baseInput())).toEqual({});
  });

  it("titleが空ならエラー", () => {
    const errors = validateRecipeInput(baseInput({ title: "" }));
    expect(errors.title).toBeDefined();
  });

  it("titleが空白のみならエラー", () => {
    const errors = validateRecipeInput(baseInput({ title: "   " }));
    expect(errors.title).toBeDefined();
  });

  it("ingredientsが0件ならエラー", () => {
    const errors = validateRecipeInput(baseInput({ ingredients: [] }));
    expect(errors.ingredients).toBeDefined();
  });

  it("ingredientの名前が空ならフィールド単位のエラー", () => {
    const errors = validateRecipeInput(
      baseInput({
        ingredients: [
          { id: "i1", name: "", quantity: null, unit: null, note: null },
        ],
      }),
    );
    expect(errors["ingredients.i1.name"]).toBeDefined();
  });

  it("複数の材料がある場合、エラーは行のidに紐づく(順番に依存しない)", () => {
    const errors = validateRecipeInput(
      baseInput({
        ingredients: [
          { id: "i1", name: "鮭", quantity: null, unit: null, note: null },
          { id: "i2", name: "", quantity: null, unit: null, note: null },
        ],
      }),
    );
    expect(errors["ingredients.i2.name"]).toBeDefined();
    expect(errors["ingredients.i1.name"]).toBeUndefined();
  });

  it("stepsが0件ならエラー", () => {
    const errors = validateRecipeInput(baseInput({ steps: [] }));
    expect(errors.steps).toBeDefined();
  });

  it("stepのinstructionが空ならフィールド単位のエラー", () => {
    const errors = validateRecipeInput(
      baseInput({ steps: [{ id: "s1", instruction: "  " }] }),
    );
    expect(errors["steps.s1.instruction"]).toBeDefined();
  });

  it("cookingTimeMinutesがnullなら許可", () => {
    const errors = validateRecipeInput(baseInput({ cookingTimeMinutes: null }));
    expect(errors.cookingTimeMinutes).toBeUndefined();
  });

  it("cookingTimeMinutesが負ならエラー", () => {
    const errors = validateRecipeInput(baseInput({ cookingTimeMinutes: -1 }));
    expect(errors.cookingTimeMinutes).toBeDefined();
  });

  it("cookingTimeMinutesが整数でなければエラー", () => {
    const errors = validateRecipeInput(baseInput({ cookingTimeMinutes: 1.5 }));
    expect(errors.cookingTimeMinutes).toBeDefined();
  });

  it("cookingTimeMinutesが0以上の整数なら許可", () => {
    const errors = validateRecipeInput(baseInput({ cookingTimeMinutes: 0 }));
    expect(errors.cookingTimeMinutes).toBeUndefined();
  });

  it("複数のエラーを同時に返せる", () => {
    const errors = validateRecipeInput(
      baseInput({ title: "", ingredients: [], steps: [] }),
    );
    expect(Object.keys(errors).sort()).toEqual(
      ["ingredients", "steps", "title"].sort(),
    );
  });
});
