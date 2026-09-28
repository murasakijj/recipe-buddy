import { describe, it, expect } from "vitest";
import {
  importNormalizeRequestSchema,
  importNormalizeResponseSchema,
} from "./schema.js";

describe("importNormalizeRequestSchema", () => {
  it("有効なMarkdownをパースできる", () => {
    const result = importNormalizeRequestSchema.safeParse({
      markdown: "# レシピ\n## 材料\n- 塩 | | |\n",
    });
    expect(result.success).toBe(true);
  });

  it("markdownが空文字なら失敗する", () => {
    const result = importNormalizeRequestSchema.safeParse({ markdown: "" });
    expect(result.success).toBe(false);
  });

  it("markdownが未指定なら失敗する", () => {
    const result = importNormalizeRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("markdownが30000文字ちょうどなら成功する", () => {
    const result = importNormalizeRequestSchema.safeParse({
      markdown: "あ".repeat(30_000),
    });
    expect(result.success).toBe(true);
  });

  it("markdownが30001文字なら失敗する(上限30000)", () => {
    const result = importNormalizeRequestSchema.safeParse({
      markdown: "あ".repeat(30_001),
    });
    expect(result.success).toBe(false);
  });
});

describe("importNormalizeResponseSchema", () => {
  it("有効なレスポンスをパースできる", () => {
    const result = importNormalizeResponseSchema.safeParse({
      markdown: "# レシピ\n",
    });
    expect(result.success).toBe(true);
  });

  it("markdownが無ければ失敗する", () => {
    const result = importNormalizeResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("markdownが空文字なら失敗する(呼び出し側で502 invalid_ai_outputとして扱う)", () => {
    const result = importNormalizeResponseSchema.safeParse({ markdown: "" });
    expect(result.success).toBe(false);
  });
});
