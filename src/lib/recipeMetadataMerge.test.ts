import { describe, it, expect } from "vitest";
import {
  applyMetadataToTemplate,
  type ClassifiedMetadata,
} from "./recipeMetadataMerge";

function meta(overrides: Partial<ClassifiedMetadata> = {}): ClassifiedMetadata {
  return {
    category: null,
    tags: [],
    servings: null,
    cookingTimeMinutes: null,
    ...overrides,
  };
}

describe("applyMetadataToTemplate", () => {
  it("空欄のメタデータ行が分類結果で埋まる", () => {
    const template = `# レシピ
- カテゴリ:
- 人数:
- 調理時間:
- タグ: 2026-09-27

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const result = applyMetadataToTemplate(template, [
      meta({
        category: "主食",
        servings: "1人分",
        cookingTimeMinutes: 20,
        tags: ["ナス", "炒め物"],
      }),
    ]);

    expect(result).toContain("- カテゴリ: 主食");
    expect(result).toContain("- 人数: 1人分");
    expect(result).toContain("- 調理時間: 20");
    expect(result).toContain("- タグ: 2026-09-27, ナス, 炒め物");
  });

  it("既に値が入っている項目(カテゴリ・人数・調理時間)は上書きしない", () => {
    const template = `# レシピ
- カテゴリ: 副菜
- 人数: 2人分
- 調理時間: 15
- タグ: 2026-09-27

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const result = applyMetadataToTemplate(template, [
      meta({
        category: "主食",
        servings: "1人分",
        cookingTimeMinutes: 99,
        tags: [],
      }),
    ]);

    expect(result).toContain("- カテゴリ: 副菜");
    expect(result).toContain("- 人数: 2人分");
    expect(result).toContain("- 調理時間: 15");
    expect(result).not.toContain("主食");
    expect(result).not.toContain("- 人数: 1人分");
    expect(result).not.toContain("99");
  });

  it("タグは既存値があってもマージされる(重複除去・最大5個)", () => {
    const template = `# レシピ
- タグ: 2026-09-27, ナス

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const result = applyMetadataToTemplate(template, [
      meta({ tags: ["ナス", "ひき肉", "炒め物", "追加1", "追加2"] }),
    ]);

    // 既存の "2026-09-27" は保持され、新規タグとマージされ、重複("ナス")は除去され、
    // 5個を超える分は切り詰められる。
    expect(result).toContain(
      "- タグ: 2026-09-27, ナス, ひき肉, 炒め物, 追加1",
    );
    expect(result).not.toContain("追加2");
  });

  it("メタデータ行が無いブロックには、タイトル直後にカテゴリ→人数→調理時間→タグの順で挿入する", () => {
    const template = `# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const result = applyMetadataToTemplate(template, [
      meta({
        category: "副菜",
        servings: "2人分",
        cookingTimeMinutes: 10,
        tags: ["ナス"],
      }),
    ]);

    const lines = result.split("\n");
    const titleIdx = lines.findIndex((l) => l === "# レシピ");
    expect(lines[titleIdx + 1]).toBe("- カテゴリ: 副菜");
    expect(lines[titleIdx + 2]).toBe("- 人数: 2人分");
    expect(lines[titleIdx + 3]).toBe("- 調理時間: 10");
    expect(lines[titleIdx + 4]).toBe("- タグ: ナス");
  });

  it("レシピ件数とmetadata件数がズレていても(nullを含んでも)落ちない", () => {
    const template = `# レシピA

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。

# レシピB

## 材料
- 砂糖 | 少々 | |

## 手順
1. 甘くする。

# レシピC

## 材料
- 酢 | 少々 | |

## 手順
1. 酸っぱくする。
`;
    // metadataは2件しか無く(3件目は無い)、さらに1件目はnull(分類失敗扱い)。
    expect(() =>
      applyMetadataToTemplate(template, [
        null,
        meta({ category: "副菜", tags: ["砂糖"] }),
      ]),
    ).not.toThrow();

    const result = applyMetadataToTemplate(template, [
      null,
      meta({ category: "副菜", tags: ["砂糖"] }),
    ]);
    // レシピAはnullなので変化なし。
    expect(result).toMatch(/# レシピA\n\n## 材料/);
    // レシピBは分類結果が反映される。
    expect(result).toContain("- カテゴリ: 副菜");
    // レシピCはmetadata配列に対応要素が無いので変化なし。
    expect(result).toMatch(/# レシピC\n\n## 材料/);
  });

  it("コードフェンス内やメモ以降のセクションは変更しない", () => {
    const template = `# レシピ
- カテゴリ:

\`\`\`
- カテゴリ: フェンス内は無視
\`\`\`

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。

## メモ
- カテゴリ: メモ欄も無視
`;
    const result = applyMetadataToTemplate(template, [meta({ category: "主菜" })]);

    // メタデータ領域の空欄は埋まる。
    expect(result).toContain("- カテゴリ: 主菜");
    // フェンス内・メモ欄の行はそのまま残る(書き換えられない)。
    expect(result).toContain("- カテゴリ: フェンス内は無視");
    expect(result).toContain("- カテゴリ: メモ欄も無視");
  });
});
