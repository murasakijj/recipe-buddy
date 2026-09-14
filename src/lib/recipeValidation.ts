import type { RecipeInput } from "./types";

/** フィールド名(または `ingredients.<id>.name`, `steps.<id>.instruction`) → エラーメッセージ。
 * 行の識別には配列インデックスではなく各行の `id` を使う。
 * 並び替え・削除をしても、エラーが別の行に付け替わらないようにするため。 */
export type ValidationErrors = Record<string, string>;

export function validateRecipeInput(input: RecipeInput): ValidationErrors {
  const errors: ValidationErrors = {};

  if (input.title.trim().length === 0) {
    errors.title = "レシピ名を入力してください。";
  }

  if (input.ingredients.length === 0) {
    errors.ingredients = "材料を1件以上入力してください。";
  } else {
    input.ingredients.forEach((ingredient) => {
      if (ingredient.name.trim().length === 0) {
        errors[`ingredients.${ingredient.id}.name`] =
          "材料名を入力してください。";
      }
    });
  }

  if (input.steps.length === 0) {
    errors.steps = "手順を1件以上入力してください。";
  } else {
    input.steps.forEach((step) => {
      if (step.instruction.trim().length === 0) {
        errors[`steps.${step.id}.instruction`] = "手順を入力してください。";
      }
    });
  }

  if (input.cookingTimeMinutes !== null) {
    if (
      !Number.isInteger(input.cookingTimeMinutes) ||
      input.cookingTimeMinutes < 0
    ) {
      errors.cookingTimeMinutes = "調理時間は0以上の整数で入力してください。";
    }
  }

  return errors;
}
