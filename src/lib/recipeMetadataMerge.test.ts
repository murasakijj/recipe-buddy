import { describe, it, expect } from "vitest";
import {
  applyMetadataToTemplate,
  type ClassifiedMetadata,
} from "./recipeMetadataMerge";
import { parseRecipeTemplate } from "./recipeMarkdown";

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

  // --- 再レビューで見つかった回帰の修正確認テスト ---

  it("A3: 出力全体がコードフェンスで包まれていても、外側のフェンスを外して分類結果を反映する(no-opにならない)", () => {
    const template =
      "```markdown\n" +
      `# レシピA
- カテゴリ:

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。

# レシピB
- カテゴリ:

## 材料
- 砂糖 | 少々 | |

## 手順
1. 甘くする。
` +
      "```\n";

    const result = applyMetadataToTemplate(template, [
      meta({ category: "主菜" }),
      meta({ category: "副菜" }),
    ]);

    // 以前は全行が「フェンス内」と誤判定され、no-opになって
    // カテゴリが埋まらなかった(2026-09-29 再レビューA3)。
    expect(result).toContain("- カテゴリ: 主菜");
    expect(result).toContain("- カテゴリ: 副菜");
  });

  it("B1: 重複したメタデータキーは後勝ち(パーサと同じ意味論)で、既存値ありとして扱う", () => {
    const template = `# レシピ
- カテゴリ: 主菜
- カテゴリ: 副菜

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const result = applyMetadataToTemplate(template, [meta({ category: "主食" })]);

    // 後勝ちの"副菜"が既存値として扱われ、AIの"主食"では上書きされない。
    expect(result).toContain("- カテゴリ: 主菜");
    expect(result).toContain("- カテゴリ: 副菜");
    expect(result).not.toContain("- カテゴリ: 主食");
  });

  it("複数レシピで、それぞれが対応する正しいmetadata要素の内容を受け取る(取り違えない)", () => {
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
    const result = applyMetadataToTemplate(template, [
      meta({ category: "主菜", tags: ["タグA"] }),
      meta({ category: "副菜", tags: ["タグB"] }),
      meta({ category: "デザート", tags: ["タグC"] }),
    ]);

    const blockA = result.split("# レシピB")[0];
    const blockB = result.split("# レシピB")[1].split("# レシピC")[0];
    const blockC = result.split("# レシピC")[1];

    expect(blockA).toContain("- カテゴリ: 主菜");
    expect(blockA).toContain("- タグ: タグA");
    expect(blockB).toContain("- カテゴリ: 副菜");
    expect(blockB).toContain("- タグ: タグB");
    expect(blockC).toContain("- カテゴリ: デザート");
    expect(blockC).toContain("- タグ: タグC");
  });

  it("0件のmetadata・空文字テンプレートでも例外を投げない", () => {
    expect(() => applyMetadataToTemplate("", [])).not.toThrow();
    expect(applyMetadataToTemplate("", [])).toBe("");

    const template = `# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    expect(() => applyMetadataToTemplate(template, [])).not.toThrow();
    // metadataが空配列(=対応するインデックスが無い)なので変化しない。
    expect(applyMetadataToTemplate(template, [])).toBe(template.replace(/\r\n/g, "\n"));
  });

  it("全角コロン(「- カテゴリ：」)のメタデータ行も認識し、既存値があれば上書きしない", () => {
    const template = `# レシピ
- カテゴリ：副菜

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const result = applyMetadataToTemplate(template, [meta({ category: "主食" })]);
    expect(result).toContain("- カテゴリ：副菜");
    expect(result).not.toContain("主食");
  });

  it("全角コロンで値が空の行も、半角コロンと同様に埋まる(書き込み時は半角コロンに統一される)", () => {
    const template = `# レシピ
- カテゴリ：

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const result = applyMetadataToTemplate(template, [meta({ category: "主食" })]);
    // 空欄だったので埋まる。書き込むときの表記は(既存の全角コロンではなく)
    // buildLineが常に使う半角コロンの形式に統一される。
    expect(result).toContain("- カテゴリ: 主食");
    expect(result).not.toContain("- カテゴリ：");
  });

  it("タグが既に上限(5個)まで埋まっていると、新しいタグはすべて落ちる", () => {
    const template = `# レシピ
- タグ: a, b, c, d, e

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const result = applyMetadataToTemplate(template, [
      meta({ tags: ["新タグ1", "新タグ2"] }),
    ]);

    expect(result).toContain("- タグ: a, b, c, d, e");
    expect(result).not.toContain("新タグ1");
    expect(result).not.toContain("新タグ2");
  });

  it("整合性テスト: 同じ入力をパーサとmergeの両方に通すと、認識するレシピ件数が一致する(判定ロジックがズレたら落ちる)", () => {
    const templates = [
      // 通常の複数レシピ
      `# レシピA

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。

# レシピB

## 材料
- 砂糖 | 少々 | |

## 手順
1. 甘くする。
`,
      // 出力全体がコードフェンスで包まれたケース(A3)
      "```markdown\n# レシピ\n\n## 材料\n- 塩 | 少々 | |\n\n## 手順\n1. 味付けする。\n```\n",
      // 途中にネストしたコードフェンスがあるケース
      `# レシピ

\`\`\`
# フェンス内の偽見出し
\`\`\`

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`,
    ];

    for (const template of templates) {
      const { recipes } = parseRecipeTemplate(template);
      // ダミーのカテゴリを認識レシピ数ぶん用意し、mergeに通す。
      const metadata = recipes.map((_, i) => meta({ category: `カテゴリ${i}` }));
      const merged = applyMetadataToTemplate(template, metadata);

      // mergeが正しく同じ件数のレシピを認識していれば、それぞれのダミー
      // カテゴリが過不足なく出力に含まれるはず(件数がズレれば、挿入位置が
      // ずれるか、一部が反映されずに不一致になる)。
      const foundCount = metadata.filter((m) =>
        merged.includes(`- カテゴリ: ${m!.category}`),
      ).length;
      expect(foundCount).toBe(recipes.length);
    }
  });
});
