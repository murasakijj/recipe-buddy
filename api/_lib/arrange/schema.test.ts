import { describe, it, expect } from "vitest";
import {
  arrangeRequestSchema,
  arrangedRecipeSchema,
  sanitizeArrangedRecipe,
  stripUnknownTechniqueMarkers,
} from "./schema.js";
// テストのみ src/ を直接importしてよい(テストはFunctionにバンドルされないため)。
// api/_lib/arrange/schema.ts 内の stripUnknownTechniqueMarkers は
// src/lib/techniqueMarkup.ts の正規表現ロジックを複製したものなので、
// 挙動が食い違っていないかをここで確認する(L-7)。
import { stripMarkers } from "../../../src/lib/techniqueMarkup.js";

const validBody = {
  recipe: {
    title: "鮭のホイル焼き",
    description: null,
    servings: "2",
    cookingTimeMinutes: 25,
    ingredients: [{ name: "鮭", quantity: "2", unit: "切れ", note: null }],
    steps: [{ instruction: "人参を[[tq_1|細切り]]にする。" }],
  },
  request: "玉ねぎがない。人参ならある。",
  techniques: [{ id: "tq_1", name: "細切り", summary: "3〜4mm幅に切る" }],
};

describe("arrangeRequestSchema", () => {
  it("有効なボディをパースできる", () => {
    const result = arrangeRequestSchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it("requestが空文字なら失敗する", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      request: "",
    });
    expect(result.success).toBe(false);
  });

  it("requestが2000文字ちょうどなら成功する", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      request: "あ".repeat(2000),
    });
    expect(result.success).toBe(true);
  });

  it("requestが2001文字なら失敗する", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      request: "あ".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("requestが1文字なら成功する", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      request: "あ",
    });
    expect(result.success).toBe(true);
  });

  it("recipeが無ければ失敗する", () => {
    const rest = {
      request: validBody.request,
      techniques: validBody.techniques,
    };
    const result = arrangeRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("titleが201文字なら失敗する(上限200)", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      recipe: { ...validBody.recipe, title: "あ".repeat(201) },
    });
    expect(result.success).toBe(false);
  });

  it("descriptionが2001文字なら失敗する(上限2000)", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      recipe: { ...validBody.recipe, description: "あ".repeat(2001) },
    });
    expect(result.success).toBe(false);
  });

  it("材料名が101文字なら失敗する(上限100)", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      recipe: {
        ...validBody.recipe,
        ingredients: [{ name: "あ".repeat(101) }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("手順が2001文字なら失敗する(上限2000)", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      recipe: {
        ...validBody.recipe,
        steps: [{ instruction: "あ".repeat(2001) }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("technique名が101文字なら失敗する(上限100)", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      techniques: [{ id: "tq_1", name: "あ".repeat(101) }],
    });
    expect(result.success).toBe(false);
  });

  it("technique summaryが501文字なら失敗する(上限500)", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      techniques: [{ id: "tq_1", name: "細切り", summary: "あ".repeat(501) }],
    });
    expect(result.success).toBe(false);
  });

  it("ingredientsが空配列なら失敗する(1件以上必須)", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      recipe: { ...validBody.recipe, ingredients: [] },
    });
    expect(result.success).toBe(false);
  });

  it("stepsが空配列なら失敗する(1件以上必須)", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      recipe: { ...validBody.recipe, steps: [] },
    });
    expect(result.success).toBe(false);
  });

  it("ingredientsが101件なら失敗する(上限100)", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      recipe: {
        ...validBody.recipe,
        ingredients: Array.from({ length: 101 }, (_, i) => ({
          name: `材料${i}`,
        })),
      },
    });
    expect(result.success).toBe(false);
  });

  it("techniquesが501件なら失敗する(上限500)", () => {
    const result = arrangeRequestSchema.safeParse({
      ...validBody,
      techniques: Array.from({ length: 501 }, (_, i) => ({
        id: `tq_${i}`,
        name: `技法${i}`,
      })),
    });
    expect(result.success).toBe(false);
  });
});

describe("arrangedRecipeSchema", () => {
  it("有効なAI出力をパースできる", () => {
    const result = arrangedRecipeSchema.safeParse({
      title: "鮭と人参のホイル焼き",
      changeSummary: ["玉ねぎを削除し、人参を追加"],
      ingredients: [{ name: "鮭", quantity: "2", unit: "切れ", note: null }],
      steps: [{ instruction: "人参を[[tq_1|細切り]]にする。" }],
      safetyNotes: [],
      questions: [],
      newTechniqueCandidates: [],
    });
    expect(result.success).toBe(true);
  });

  it("配列フィールドが省略されてもdefaultで補われる", () => {
    const result = arrangedRecipeSchema.safeParse({
      title: "t",
      ingredients: [{ name: "a" }],
      steps: [{ instruction: "b" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.changeSummary).toEqual([]);
      expect(result.data.safetyNotes).toEqual([]);
      expect(result.data.questions).toEqual([]);
      expect(result.data.newTechniqueCandidates).toEqual([]);
    }
  });

  it("stepsが空配列でもパース自体は成功する(空チェックはsanitize側)", () => {
    const result = arrangedRecipeSchema.safeParse({
      title: "t",
      ingredients: [{ name: "a" }],
      steps: [],
    });
    expect(result.success).toBe(true);
  });

  it("quantity/unitが数値でもパースでき、文字列に変換される", () => {
    const result = arrangedRecipeSchema.safeParse({
      title: "t",
      ingredients: [{ name: "鮭", quantity: 2, unit: 100 }],
      steps: [{ instruction: "焼く" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ingredients[0]).toMatchObject({
        quantity: "2",
        unit: "100",
      });
    }
  });
});

describe("stripUnknownTechniqueMarkers", () => {
  it("既知のidは変更しない", () => {
    const text = "人参を[[tq_1|細切り]]にする。";
    expect(stripUnknownTechniqueMarkers(text, new Set(["tq_1"]))).toBe(text);
  });

  it("未知のidは語句だけに置き換える", () => {
    const text = "人参を[[tq_bad|細切り]]にする。";
    expect(stripUnknownTechniqueMarkers(text, new Set(["tq_1"]))).toBe(
      "人参を細切りにする。",
    );
  });

  it("壊れたマーカーはそのまま残す", () => {
    const text = "[[bad]]のみ";
    expect(stripUnknownTechniqueMarkers(text, new Set())).toBe(text);
  });

  // api/ 側の複製実装が src/lib/techniqueMarkup.ts の parseInstruction/stripMarkers
  // と同じ意味論であることを、紛らわしい入力の集合で確認する(L-7)。
  // knownIds を空集合にすれば、有効なマーカーは常に「未知」扱いになり、
  // stripMarkers(text)(常に表示語句へ変換)と結果が一致するはず。
  describe("src/lib/techniqueMarkup.ts の stripMarkers との整合性", () => {
    const TRICKY_INPUTS = [
      "[[[tq_x|語]]", // 余分な開き括弧
      "[[tq_x]]", // | が無い
      "[[|語]]", // idが空
      "[[tq_x|]]", // 表示語句が空
      "[[tq_x|語", // 閉じられていない
      "[[a|[[b|c]]語]]", // 入れ子っぽい記法
      "人参を[[tq_unknown|細切り]]にする。", // 未知のid
      "[[a|A]]と[[b|B]]", // 複数マーカー
      "", // 空文字
      "ただのテキスト", // マーカー無し
    ];

    it.each(TRICKY_INPUTS)("入力: %j", (text) => {
      expect(stripUnknownTechniqueMarkers(text, new Set())).toBe(
        stripMarkers(text),
      );
    });
  });
});

describe("sanitizeArrangedRecipe", () => {
  it("文字列をtrimし、未知のtechniqueIdを語句に置き換える", () => {
    const sanitized = sanitizeArrangedRecipe(
      {
        title: "  鮭のアレンジ  ",
        changeSummary: [" 玉ねぎを削除 "],
        ingredients: [
          { name: " 鮭 ", quantity: " 2 ", unit: "切れ", note: null },
        ],
        steps: [{ instruction: "人参を[[tq_bad|細切り]]にする。 " }],
        safetyNotes: [],
        questions: [],
        newTechniqueCandidates: [],
      },
      new Set(["tq_1"]),
      "元レシピ",
    );
    expect(sanitized.title).toBe("鮭のアレンジ");
    expect(sanitized.changeSummary).toEqual(["玉ねぎを削除"]);
    expect(sanitized.ingredients[0]).toEqual({
      name: "鮭",
      quantity: "2",
      unit: "切れ",
      note: null,
    });
    expect(sanitized.steps[0].instruction).toBe("人参を細切りにする。");
  });

  it("既知のtechniqueIdはマーカーのまま残す", () => {
    const sanitized = sanitizeArrangedRecipe(
      {
        title: "t",
        changeSummary: [],
        ingredients: [{ name: "鮭" }],
        steps: [{ instruction: "人参を[[tq_1|細切り]]にする。" }],
        safetyNotes: [],
        questions: [],
        newTechniqueCandidates: [],
      },
      new Set(["tq_1"]),
      "元レシピ",
    );
    expect(sanitized.steps[0].instruction).toBe(
      "人参を[[tq_1|細切り]]にする。",
    );
  });

  it("名前が空の材料は除去される", () => {
    const sanitized = sanitizeArrangedRecipe(
      {
        title: "t",
        changeSummary: [],
        ingredients: [{ name: "鮭" }, { name: "   " }],
        steps: [{ instruction: "焼く" }],
        safetyNotes: [],
        questions: [],
        newTechniqueCandidates: [],
      },
      new Set(),
      "元レシピ",
    );
    expect(sanitized.ingredients).toHaveLength(1);
  });

  it("titleが空ならfallbackTitleを使う(元タイトル＋（アレンジ）)", () => {
    const sanitized = sanitizeArrangedRecipe(
      {
        title: "   ",
        changeSummary: [],
        ingredients: [{ name: "鮭" }],
        steps: [{ instruction: "焼く" }],
        safetyNotes: [],
        questions: [],
        newTechniqueCandidates: [],
      },
      new Set(),
      "鮭のホイル焼き",
    );
    expect(sanitized.title).toBe("鮭のホイル焼き（アレンジ）");
  });

  it("titleが非空ならfallbackTitleは使わない", () => {
    const sanitized = sanitizeArrangedRecipe(
      {
        title: "鮭と人参のホイル焼き",
        changeSummary: [],
        ingredients: [{ name: "鮭" }],
        steps: [{ instruction: "焼く" }],
        safetyNotes: [],
        questions: [],
        newTechniqueCandidates: [],
      },
      new Set(),
      "鮭のホイル焼き",
    );
    expect(sanitized.title).toBe("鮭と人参のホイル焼き");
  });

  it("材料が結果的に0件になったら例外を投げる", () => {
    expect(() =>
      sanitizeArrangedRecipe(
        {
          title: "t",
          changeSummary: [],
          ingredients: [{ name: "   " }],
          steps: [{ instruction: "焼く" }],
          safetyNotes: [],
          questions: [],
          newTechniqueCandidates: [],
        },
        new Set(),
        "元レシピ",
      ),
    ).toThrow();
  });

  it("手順が結果的に0件になったら例外を投げる", () => {
    expect(() =>
      sanitizeArrangedRecipe(
        {
          title: "t",
          changeSummary: [],
          ingredients: [{ name: "鮭" }],
          steps: [{ instruction: "   " }],
          safetyNotes: [],
          questions: [],
          newTechniqueCandidates: [],
        },
        new Set(),
        "元レシピ",
      ),
    ).toThrow();
  });

  it("空の手順配列は例外を投げる", () => {
    expect(() =>
      sanitizeArrangedRecipe(
        {
          title: "t",
          changeSummary: [],
          ingredients: [{ name: "鮭" }],
          steps: [],
          safetyNotes: [],
          questions: [],
          newTechniqueCandidates: [],
        },
        new Set(),
        "元レシピ",
      ),
    ).toThrow();
  });
});
