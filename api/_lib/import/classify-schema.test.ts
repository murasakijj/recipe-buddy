import { describe, it, expect } from "vitest";
import {
  importClassifyRequestSchema,
  importClassifyResponseRawSchema,
  sanitizeClassifiedMetadata,
  CATEGORY_VOCABULARY,
} from "./classify-schema.js";

const validRecipe = {
  title: "ナスとひき肉のみそペペロンチーノ",
  ingredients: ["パスタ", "ナス", "ひき肉", "味噌"],
  steps: ["パスタを茹でる。", "ナスを切る。", "ひき肉を炒める。"],
};

describe("importClassifyRequestSchema", () => {
  it("有効なリクエストをパースできる", () => {
    const result = importClassifyRequestSchema.safeParse({
      recipes: [validRecipe],
    });
    expect(result.success).toBe(true);
  });

  it("recipesが空配列なら失敗する(1件以上必須)", () => {
    const result = importClassifyRequestSchema.safeParse({ recipes: [] });
    expect(result.success).toBe(false);
  });

  it("recipesが21件なら失敗する(上限20)", () => {
    const result = importClassifyRequestSchema.safeParse({
      recipes: Array.from({ length: 21 }, () => validRecipe),
    });
    expect(result.success).toBe(false);
  });

  it("recipesが20件なら成功する", () => {
    const result = importClassifyRequestSchema.safeParse({
      recipes: Array.from({ length: 20 }, () => validRecipe),
    });
    expect(result.success).toBe(true);
  });

  it("titleが201文字なら失敗する(上限200)", () => {
    const result = importClassifyRequestSchema.safeParse({
      recipes: [{ ...validRecipe, title: "あ".repeat(201) }],
    });
    expect(result.success).toBe(false);
  });

  it("材料名が101文字なら失敗する(上限100)", () => {
    const result = importClassifyRequestSchema.safeParse({
      recipes: [{ ...validRecipe, ingredients: ["あ".repeat(101)] }],
    });
    expect(result.success).toBe(false);
  });

  it("手順が501文字なら失敗する(上限500)", () => {
    const result = importClassifyRequestSchema.safeParse({
      recipes: [{ ...validRecipe, steps: ["あ".repeat(501)] }],
    });
    expect(result.success).toBe(false);
  });

  it("ingredients/stepsが空配列でも成功する(材料・手順が無いレシピもありうる)", () => {
    const result = importClassifyRequestSchema.safeParse({
      recipes: [{ title: "レシピ", ingredients: [], steps: [] }],
    });
    expect(result.success).toBe(true);
  });

  it("再レビューB9: 合計文字数が上限(50000)を超えると失敗する", () => {
    // 1件あたりの上限には収まるが、20件分の合計では上限を超えるようにする。
    const bigRecipe = {
      title: "あ".repeat(200),
      ingredients: Array.from({ length: 60 }, () => "い".repeat(100)),
      steps: Array.from({ length: 60 }, () => "う".repeat(500)),
    };
    const result = importClassifyRequestSchema.safeParse({
      recipes: Array.from({ length: 20 }, () => bigRecipe),
    });
    expect(result.success).toBe(false);
  });

  it("再レビューB9: 合計文字数が上限以内なら成功する", () => {
    const result = importClassifyRequestSchema.safeParse({
      recipes: Array.from({ length: 20 }, () => validRecipe),
    });
    expect(result.success).toBe(true);
  });
});

describe("importClassifyResponseRawSchema", () => {
  it("有効なAI出力をパースできる", () => {
    const result = importClassifyResponseRawSchema.safeParse({
      results: [
        { category: "主食", tags: ["2026-09-27", "ナス"], servings: "1人分", cookingTimeMinutes: 20 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("tagsが省略されても(undefinedのまま)パースは成功する(空配列化はsanitize側の責務)", () => {
    const result = importClassifyResponseRawSchema.safeParse({
      results: [{ category: "主食", servings: null, cookingTimeMinutes: null }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.results[0].tags).toBeUndefined();
    }
  });

  it("tagsがnullでもパースは成功する(再レビューB2: AIがnullを返すケース)", () => {
    const result = importClassifyResponseRawSchema.safeParse({
      results: [
        { category: "主食", tags: null, servings: null, cookingTimeMinutes: null },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.results[0].tags).toBeNull();
    }
  });

  it("cookingTimeMinutesが数値文字列でもパースでき、数値に変換される", () => {
    const result = importClassifyResponseRawSchema.safeParse({
      results: [{ category: "主食", tags: [], servings: null, cookingTimeMinutes: "20" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.results[0].cookingTimeMinutes).toBe(20);
    }
  });

  it("resultsが空配列でもパース自体は成功する(件数照合はハンドラ側の責務)", () => {
    const result = importClassifyResponseRawSchema.safeParse({ results: [] });
    expect(result.success).toBe(true);
  });
});

describe("sanitizeClassifiedMetadata", () => {
  it("カテゴリが7種類の語彙内ならそのまま採用する", () => {
    for (const category of CATEGORY_VOCABULARY) {
      const sanitized = sanitizeClassifiedMetadata({
        category,
        tags: [],
        servings: null,
        cookingTimeMinutes: null,
      });
      expect(sanitized.category).toBe(category);
    }
  });

  it("カテゴリが語彙外ならnullにする", () => {
    const sanitized = sanitizeClassifiedMetadata({
      category: "スープ",
      tags: [],
      servings: null,
      cookingTimeMinutes: null,
    });
    expect(sanitized.category).toBeNull();
  });

  it("カテゴリが無ければnullにする", () => {
    const sanitized = sanitizeClassifiedMetadata({
      tags: [],
      servings: null,
      cookingTimeMinutes: null,
    });
    expect(sanitized.category).toBeNull();
  });

  it("タグの空文字・重複を除去する", () => {
    const sanitized = sanitizeClassifiedMetadata({
      category: null,
      tags: ["ナス", "", "ナス", "  ", "炒め物"],
      servings: null,
      cookingTimeMinutes: null,
    });
    expect(sanitized.tags).toEqual(["ナス", "炒め物"]);
  });

  it("タグが5個を超えたら切り詰める", () => {
    const sanitized = sanitizeClassifiedMetadata({
      category: null,
      tags: ["a", "b", "c", "d", "e", "f", "g"],
      servings: null,
      cookingTimeMinutes: null,
    });
    expect(sanitized.tags).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("調理法の語彙外のタグはそのまま残す(材料名などの自由なタグは落とさない)", () => {
    const sanitized = sanitizeClassifiedMetadata({
      category: null,
      tags: ["ナス", "ひき肉", "パスタ"],
      servings: null,
      cookingTimeMinutes: null,
    });
    expect(sanitized.tags).toEqual(["ナス", "ひき肉", "パスタ"]);
  });

  it("servingsが空文字・空白ならnullにする", () => {
    expect(
      sanitizeClassifiedMetadata({
        category: null,
        tags: [],
        servings: "  ",
        cookingTimeMinutes: null,
      }).servings,
    ).toBeNull();
  });

  it("servingsがあればtrimして採用する", () => {
    expect(
      sanitizeClassifiedMetadata({
        category: null,
        tags: [],
        servings: " 2人分 ",
        cookingTimeMinutes: null,
      }).servings,
    ).toBe("2人分");
  });

  it("cookingTimeMinutesが正の整数ならそのまま採用する", () => {
    expect(
      sanitizeClassifiedMetadata({
        category: null,
        tags: [],
        servings: null,
        cookingTimeMinutes: 20,
      }).cookingTimeMinutes,
    ).toBe(20);
  });

  it("cookingTimeMinutesが0や負の数ならnullにする", () => {
    expect(
      sanitizeClassifiedMetadata({
        category: null,
        tags: [],
        servings: null,
        cookingTimeMinutes: 0,
      }).cookingTimeMinutes,
    ).toBeNull();
    expect(
      sanitizeClassifiedMetadata({
        category: null,
        tags: [],
        servings: null,
        cookingTimeMinutes: -5,
      }).cookingTimeMinutes,
    ).toBeNull();
  });

  it("cookingTimeMinutesが整数でなければnullにする", () => {
    expect(
      sanitizeClassifiedMetadata({
        category: null,
        tags: [],
        servings: null,
        cookingTimeMinutes: 20.5,
      }).cookingTimeMinutes,
    ).toBeNull();
  });

  it("再レビューB2: tagsがnullでも空配列として扱う(20件のチャンクを丸ごと捨てない)", () => {
    const sanitized = sanitizeClassifiedMetadata({
      category: null,
      tags: null,
      servings: null,
      cookingTimeMinutes: null,
    });
    expect(sanitized.tags).toEqual([]);
  });

  it("再レビューB3: カテゴリの前後に空白があってもtrimしてから語彙照合する", () => {
    const sanitized = sanitizeClassifiedMetadata({
      category: " 主菜 ",
      tags: [],
      servings: null,
      cookingTimeMinutes: null,
    });
    expect(sanitized.category).toBe("主菜");
  });
});
