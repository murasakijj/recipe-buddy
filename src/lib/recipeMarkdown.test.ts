import { describe, it, expect } from "vitest";
import { parseRecipeTemplate } from "./recipeMarkdown";

describe("parseRecipeTemplate", () => {
  it("単一レシピを解析できる", () => {
    const md = `# パスタ
- カテゴリ: 主菜
- 人数: 1〜2食分
- 調理時間: 20
- タグ: 2026-09-27, パスタ

## 材料
- パスタ | 200 | g |
- ナス | 2 | 本 | 程度
- 味噌 | 1 | 大さじ |
- マヨネーズ | 適量 | |

## 手順
1. パスタを茹でる。
2. ナスを食べやすい大きさに切る。

## メモ
- 一味は後から足せるので少量スタート。
`;
    const { recipes, warnings } = parseRecipeTemplate(md);
    expect(warnings).toEqual([]);
    expect(recipes).toHaveLength(1);

    const { input, warnings: recipeWarnings, errors } = recipes[0];
    expect(recipeWarnings).toEqual([]);
    expect(errors).toEqual({});
    expect(input.title).toBe("パスタ");
    expect(input.category).toBe("主菜");
    expect(input.servings).toBe("1〜2食分");
    expect(input.cookingTimeMinutes).toBe(20);
    expect(input.tags).toEqual(["2026-09-27", "パスタ"]);
    expect(input.description).toBe("一味は後から足せるので少量スタート。");

    expect(input.ingredients).toHaveLength(4);
    expect(input.ingredients[0]).toMatchObject({
      name: "パスタ",
      quantity: "200",
      unit: "g",
      note: null,
    });
    expect(input.ingredients[1]).toMatchObject({
      name: "ナス",
      quantity: "2",
      unit: "本",
      note: "程度",
    });
    expect(input.ingredients[2]).toMatchObject({
      name: "味噌",
      quantity: "1",
      unit: "大さじ",
      note: null,
    });
    expect(input.ingredients[3]).toMatchObject({
      name: "マヨネーズ",
      quantity: "適量",
      unit: null,
      note: null,
    });

    expect(input.steps).toHaveLength(2);
    expect(input.steps[0].instruction).toBe("パスタを茹でる。");
    expect(input.steps[1].instruction).toBe("ナスを食べやすい大きさに切る。");

    expect(input.sourceType).toBe("manual");
    expect(input.parentRecipeId).toBeNull();
    expect(input.arrangementRequest).toBeNull();
    expect(input.safetyNotes).toEqual([]);
    expect(input.changeSummary).toEqual([]);
  });

  it("複数レシピを解析できる", () => {
    const md = `# レシピA

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。

# レシピB

## 材料
- 砂糖 | 大さじ1 | |

## 手順
1. 甘くする。
`;
    const { recipes } = parseRecipeTemplate(md);
    expect(recipes).toHaveLength(2);
    expect(recipes[0].input.title).toBe("レシピA");
    expect(recipes[1].input.title).toBe("レシピB");
    expect(recipes[0].input.steps[0].instruction).toBe("味付けする。");
    expect(recipes[1].input.steps[0].instruction).toBe("甘くする。");
  });

  it("メタデータが全欠落していても解析できる", () => {
    const md = `# シンプルレシピ

## 材料
- 水 | 100 | ml |

## 手順
1. 沸かす。
`;
    const { recipes } = parseRecipeTemplate(md);
    expect(recipes).toHaveLength(1);
    const { input, errors } = recipes[0];
    expect(input.category).toBeNull();
    expect(input.servings).toBeNull();
    expect(input.cookingTimeMinutes).toBeNull();
    expect(input.tags).toEqual([]);
    expect(input.description).toBeNull();
    expect(errors).toEqual({});
  });

  it("`|` が無い材料行は名前のみとして扱い、warningを出す(黙って落とさない)", () => {
    const md = `# レシピ

## 材料
- しょうゆ

## 手順
1. かける。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, warnings } = recipes[0];
    expect(input.ingredients).toHaveLength(1);
    expect(input.ingredients[0]).toMatchObject({
      name: "しょうゆ",
      quantity: null,
      unit: null,
      note: null,
    });
    expect(
      warnings.some((w) => w.includes("区切り(|)が見つかりません")),
    ).toBe(true);
  });

  it("手順の続き行は直前の手順に半角スペースで連結される", () => {
    const md = `# レシピ

## 材料
- 肉 | 100 | g |

## 手順
1. 下味をつける。
   冷蔵庫で30分置く。
2. 焼く。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input } = recipes[0];
    expect(input.steps).toHaveLength(2);
    expect(input.steps[0].instruction).toBe(
      "下味をつける。 冷蔵庫で30分置く。",
    );
    expect(input.steps[1].instruction).toBe("焼く。");
  });

  it("`[[id|語句]]` を含む手順が、続き行の連結を経ても壊れない", () => {
    const md = `# レシピ

## 材料
- 玉ねぎ | 1 | 個 |

## 手順
1. 玉ねぎを[[tq_1|みじん切り]]にする。
   透き通るまで炒める。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input } = recipes[0];
    expect(input.steps[0].instruction).toBe(
      "玉ねぎを[[tq_1|みじん切り]]にする。 透き通るまで炒める。",
    );
  });

  it("未知のセクション見出しはwarningを出して無視する", () => {
    const md = `# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。

## 参考リンク
- http://example.com
`;
    const { recipes } = parseRecipeTemplate(md);
    const { warnings, input } = recipes[0];
    expect(warnings.some((w) => w.includes("不明なセクション"))).toBe(true);
    expect(input.ingredients).toHaveLength(1);
    expect(input.steps).toHaveLength(1);
  });

  it("調理時間が非数値ならnull扱いにしてwarningを出す", () => {
    const md = `# レシピ
- 調理時間: 約20分

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, warnings } = recipes[0];
    expect(input.cookingTimeMinutes).toBeNull();
    expect(
      warnings.some((w) => w.includes("調理時間を数値として解釈できません")),
    ).toBe(true);
  });

  it("調理時間が数字始まりなら先頭の整数だけを採用する", () => {
    const md = `# レシピ
- 調理時間: 20分

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    expect(recipes[0].input.cookingTimeMinutes).toBe(20);
  });

  it("材料0件・手順0件のときerrorsに入る", () => {
    const md = `# レシピ
- カテゴリ: 主菜
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, errors } = recipes[0];
    expect(input.ingredients).toHaveLength(0);
    expect(input.steps).toHaveLength(0);
    expect(errors.ingredients).toBeDefined();
    expect(errors.steps).toBeDefined();
  });

  it("不明なメタデータキーはwarningを出して無視する", () => {
    const md = `# レシピ
- 難易度: 簡単

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { warnings } = recipes[0];
    expect(warnings.some((w) => w.includes("不明なメタデータ項目"))).toBe(
      true,
    );
  });

  it("最初の見出しより前に本文があれば全体warningsに1件入る", () => {
    const md = `メモ書き

# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { warnings } = parseRecipeTemplate(md);
    expect(warnings).toHaveLength(1);
  });

  it("見出しが無ければ空のrecipesとwarningsを返す", () => {
    const { recipes, warnings } = parseRecipeTemplate("ただのテキスト\n");
    expect(recipes).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("recipe/2026-09-20_recipe.md を手で整形したテンプレート（3レシピ）が正しく解析できる", () => {
    const md = `# 白菜と豚ロースのミルフィーユ蒸し
- カテゴリ: 主菜
- 人数: 2人分
- 調理時間: 20
- タグ: 2026-09-20, 白菜, 蒸し料理

## 材料
- 白菜 | 1/4 | 株 |
- 豚ロース薄切り | 250〜300 | g |
- 酒 | 2 | 大さじ |
- 水 | 50〜100 | ml |
- 顆粒だし | 1/2 | 小さじ |
- ポン酢 | 適量 | |

## 手順
1. 冷凍豚ロースの場合は、冷水または流水で10〜20分ほど半解凍する。
2. 白菜と豚肉を交互に重ねる。
3. 約5cm幅に切る。
4. 鍋に断面を上にして詰める。
5. 酒、水、顆粒だしを入れる。
6. 蓋をして中火にかける。
7. 蒸気が上がったら弱めの中火にし、10〜15分蒸す。
8. 豚肉まで火が通ったら完成。
9. ポン酢で食べる。

## メモ
- 白菜1/4株を全量使用。
- 豚ロースは冷凍していたものを使用。

# ブロッコリーとミニトマトのマヨサラダ
- カテゴリ: 副菜
- 人数: 1〜2人分
- 調理時間: 10
- タグ: 2026-09-20, ブロッコリー, サラダ

## 材料
- ブロッコリー | 1/2 | 株 | 程度
- ミニトマト | 5〜8 | 個 |
- マヨネーズ | 適量 | |
- 塩・こしょう | 少々 | |

## 手順
1. ブロッコリーを小房に分ける。
2. 耐熱容器に入れ、ふんわりラップをする。
3. 600Wで2分30秒〜3分加熱する。
4. 硬ければ30秒ずつ追加する。
5. ミニトマトと合わせる。
6. マヨネーズ、塩、こしょうで和える。

## メモ
- ブロッコリー初調理。
- 茎内部に空洞＋茶色い傷みが深くあったため、その部分は使用中止。

# しめじと豆腐の味噌汁
- カテゴリ: 汁物
- 人数: 2人分
- 調理時間: 10
- タグ: 2026-09-20, しめじ, 煮物

## 材料
- 水 | 400〜450 | ml |
- しめじ | 1/2 | パック |
- 豆腐 | 150 | g | 程度
- だし | 適量 | |
- 味噌 | 1.5〜2 | 大さじ |

## 手順
1. 鍋に水とだしを入れる。
2. しめじを加えて2〜3分煮る。
3. 豆腐を加えてさらに1〜2分温める。
4. 火を弱め、味噌を溶く。
5. 沸騰させずに完成。
`;
    const { recipes, warnings } = parseRecipeTemplate(md);
    expect(warnings).toEqual([]);
    expect(recipes).toHaveLength(3);
    recipes.forEach((r) => {
      expect(r.warnings).toEqual([]);
      expect(r.errors).toEqual({});
    });

    expect(recipes[0].input.title).toBe("白菜と豚ロースのミルフィーユ蒸し");
    expect(recipes[0].input.category).toBe("主菜");
    expect(recipes[0].input.servings).toBe("2人分");
    expect(recipes[0].input.cookingTimeMinutes).toBe(20);
    expect(recipes[0].input.tags).toEqual(["2026-09-20", "白菜", "蒸し料理"]);
    expect(recipes[0].input.ingredients).toHaveLength(6);
    expect(recipes[0].input.steps).toHaveLength(9);

    expect(recipes[1].input.title).toBe("ブロッコリーとミニトマトのマヨサラダ");
    expect(recipes[1].input.category).toBe("副菜");
    expect(recipes[1].input.servings).toBe("1〜2人分");
    expect(recipes[1].input.cookingTimeMinutes).toBe(10);
    expect(recipes[1].input.tags).toEqual([
      "2026-09-20",
      "ブロッコリー",
      "サラダ",
    ]);
    expect(recipes[1].input.ingredients).toHaveLength(4);
    expect(recipes[1].input.steps).toHaveLength(6);
    expect(recipes[1].input.ingredients[0]).toMatchObject({
      name: "ブロッコリー",
      quantity: "1/2",
      unit: "株",
      note: "程度",
    });
    expect(recipes[1].input.ingredients[3]).toMatchObject({
      name: "塩・こしょう",
      quantity: "少々",
      unit: null,
      note: null,
    });

    expect(recipes[2].input.title).toBe("しめじと豆腐の味噌汁");
    expect(recipes[2].input.category).toBe("汁物");
    expect(recipes[2].input.servings).toBe("2人分");
    expect(recipes[2].input.cookingTimeMinutes).toBe(10);
    expect(recipes[2].input.tags).toEqual(["2026-09-20", "しめじ", "煮物"]);
    expect(recipes[2].input.ingredients).toHaveLength(5);
    expect(recipes[2].input.steps).toHaveLength(5);
  });

  it("CRLFとBOMを含む入力も解析できる", () => {
    const md =
      "﻿# レシピ\r\n\r\n## 材料\r\n- 塩 | 少々 | |\r\n\r\n## 手順\r\n1. 味付けする。\r\n";
    const { recipes } = parseRecipeTemplate(md);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].input.title).toBe("レシピ");
    expect(recipes[0].input.ingredients[0].quantity).toBe("少々");
  });

  // --- レビュー指摘の回帰テスト ---

  it("指摘1: 記号直後に空白が無い材料行(-塩)も解析できる", () => {
    const md = `# レシピ

## 材料
-塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    expect(recipes[0].input.ingredients).toHaveLength(1);
    expect(recipes[0].input.ingredients[0]).toMatchObject({
      name: "塩",
      quantity: "少々",
    });
  });

  it("指摘1: '*'箇条書きの材料行も解析できる", () => {
    const md = `# レシピ

## 材料
* 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    expect(recipes[0].input.ingredients[0]).toMatchObject({
      name: "塩",
      quantity: "少々",
    });
  });

  it("指摘1: 箇条書きではない材料セクションの行はwarningを出して無視する(黙って消さない)", () => {
    const md = `# レシピ

## 材料
調味料
**煮汁**
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, warnings } = recipes[0];
    // 解釈できない2行は無視されるが、材料としては数えない(warningで可視化する)。
    expect(input.ingredients).toHaveLength(1);
    expect(
      warnings.some((w) => w.includes("材料として解釈できませんでした: 調味料")),
    ).toBe(true);
    expect(
      warnings.some((w) =>
        w.includes("材料として解釈できませんでした: **煮汁**"),
      ),
    ).toBe(true);
  });

  it("指摘2: 番号直後にスペースが無い手順は別の手順として分離し、warningを出す", () => {
    const md = `# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1.切る。
2.焼く。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, warnings } = recipes[0];
    expect(input.steps).toHaveLength(2);
    expect(input.steps[0].instruction).toBe("切る。");
    expect(input.steps[1].instruction).toBe("焼く。");
    expect(
      warnings.some((w) => w.includes("手順番号の後にスペースを入れてください")),
    ).toBe(true);
  });

  it("指摘2: 全角数字の手順番号（２. 焼く。）を新しい手順として認識する", () => {
    const md = `# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1. 切る。
２. 焼く。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input } = recipes[0];
    expect(input.steps).toHaveLength(2);
    expect(input.steps[0].instruction).toBe("切る。");
    expect(input.steps[1].instruction).toBe("焼く。");
  });

  it("指摘3: '###'見出しは手順本文に混入せず、warningを出して無視される", () => {
    const md = `# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1. 切る。
### 仕上げ
2. 盛り付ける。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, warnings } = recipes[0];
    expect(input.steps).toHaveLength(2);
    expect(input.steps[0].instruction).toBe("切る。");
    expect(input.steps[1].instruction).toBe("盛り付ける。");
    expect(
      warnings.some((w) => w.includes("未対応の見出しレベルです")),
    ).toBe(true);
  });

  it("指摘3: コードフェンスの中身は手順本文に混入せず、warningを出して無視される", () => {
    const md = `# レシピ
\`\`\`markdown
# 無視されるはずの見出し
1. 無視されるはずの手順
\`\`\`

## 材料
- 塩 | 少々 | |

## 手順
1. 切る。
\`\`\`
これはコードブロックの中身
\`\`\`
2. 盛り付ける。
`;
    const { recipes, warnings } = parseRecipeTemplate(md);
    expect(recipes).toHaveLength(1);
    const { input } = recipes[0];
    expect(input.steps).toHaveLength(2);
    expect(input.steps[0].instruction).toBe("切る。");
    expect(input.steps[1].instruction).toBe("盛り付ける。");
    // フェンスに関するwarningはグローバルに積まれる(レシピ0件のときも
    // 原因調査できるようにするため。再レビューR3)。
    expect(warnings.some((w) => w.includes("コードフェンス"))).toBe(true);
  });

  it("指摘4: 末尾に余分な'|'が付いた材料行でも補足に'|'が混入しない", () => {
    const md = `# レシピ

## 材料
- ナス | 2 | 本 | 程度 |

## 手順
1. 切る。
`;
    const { recipes } = parseRecipeTemplate(md);
    expect(recipes[0].input.ingredients[0]).toMatchObject({
      name: "ナス",
      quantity: "2",
      unit: "本",
      note: "程度",
    });
  });

  it("指摘4: 5個目以降のフィールドは'|'込みで補足へ連結する", () => {
    const md = `# レシピ

## 材料
- だし | 200 | ml | 昆布|かつお

## 手順
1. 煮る。
`;
    const { recipes } = parseRecipeTemplate(md);
    expect(recipes[0].input.ingredients[0]).toMatchObject({
      name: "だし",
      quantity: "200",
      unit: "ml",
      note: "昆布|かつお",
    });
  });

  it("指摘8: 重複したメタデータキーは後勝ちの値を採用し、warningを出す", () => {
    const md = `# レシピ
- カテゴリ: 主菜
- カテゴリ: 副菜

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, warnings } = recipes[0];
    expect(input.category).toBe("副菜");
    expect(
      warnings.some((w) => w.includes("重複したメタデータ項目です")),
    ).toBe(true);
  });

  it("全角コロン（：）のメタデータ行を解析できる", () => {
    const md = `# レシピ
- カテゴリ：主菜

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    expect(recipes[0].input.category).toBe("主菜");
  });

  it("タグは「、」区切りにも対応する", () => {
    const md = `# レシピ
- タグ: 和風、時短

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    expect(recipes[0].input.tags).toEqual(["和風", "時短"]);
  });

  it("'## 作り方'は'## 手順'の別名として扱う", () => {
    const md = `# レシピ

## 材料
- 塩 | 少々 | |

## 作り方
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    expect(recipes[0].input.steps).toHaveLength(1);
    expect(recipes[0].input.steps[0].instruction).toBe("味付けする。");
  });

  it("概要とメモがあれば「概要→空行→メモ」の順で連結する", () => {
    const md = `# レシピ
- 概要: 短時間で作れる副菜。

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。

## メモ
- 冷蔵で2日持つ。
`;
    const { recipes } = parseRecipeTemplate(md);
    expect(recipes[0].input.description).toBe(
      "短時間で作れる副菜。\n\n冷蔵で2日持つ。",
    );
  });

  // --- 再レビューで見つかった回帰の修正確認テスト ---

  it("R1: 小数の続き行(0.5%)が手順番号として切られず、数値が化けない", () => {
    const md = `# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1. 塩水を作る。
0.5%の塩水で。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input } = recipes[0];
    expect(input.steps).toHaveLength(1);
    expect(input.steps[0].instruction).toBe("塩水を作る。 0.5%の塩水で。");
  });

  it("R1: 小数の続き行(1.5cm)が新しい手順として切られない", () => {
    const md = `# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1. ナスを切る。
1.5cm幅に切る。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input } = recipes[0];
    expect(input.steps).toHaveLength(1);
    expect(input.steps[0].instruction).toBe("ナスを切る。 1.5cm幅に切る。");
  });

  it("R2: 本文が空の手順番号行(2。)は空の手順を作らず、直前の手順に連結する", () => {
    const md = `# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1. 切る。
2。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, errors } = recipes[0];
    expect(input.steps).toHaveLength(1);
    expect(input.steps[0].instruction).toBe("切る。 2。");
    expect(input.steps.some((s) => s.instruction.trim().length === 0)).toBe(
      false,
    );
    expect(errors.steps).toBeUndefined();
  });

  it("R3: 出力全体がコードフェンスで包まれていても、外側のフェンスだけ外して解析できる", () => {
    const md = "```markdown\n" +
      `# レシピA

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。

# レシピB

## 材料
- 砂糖 | 大さじ1 | |

## 手順
1. 甘くする。
` +
      "```\n";
    const { recipes, warnings } = parseRecipeTemplate(md);
    expect(recipes).toHaveLength(2);
    expect(recipes[0].input.title).toBe("レシピA");
    expect(recipes[1].input.title).toBe("レシピB");
    expect(
      warnings.some((w) => w.includes("外側のフェンス")),
    ).toBe(true);
  });

  it("D1: 閉じフェンスが無い場合はwarningを出す", () => {
    const md = `# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1. 切る。
\`\`\`
閉じられないコードブロック
`;
    const { recipes, warnings } = parseRecipeTemplate(md);
    expect(recipes).toHaveLength(1);
    expect(
      warnings.some((w) => w.includes("閉じフェンスが見つかりませんでした")),
    ).toBe(true);
  });

  it("D2: '#'直後に空白が無い見出し(#仕上げ)も手順本文に混入せず無視される", () => {
    const md = `# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1. 切る。
#仕上げ
2. 盛り付ける。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, warnings } = recipes[0];
    expect(input.steps).toHaveLength(2);
    expect(input.steps[0].instruction).toBe("切る。");
    expect(input.steps[1].instruction).toBe("盛り付ける。");
    expect(warnings.some((w) => w.includes("見出し"))).toBe(true);
  });

  it("D2: '###'直後に空白が無い見出し(###仕上げ)も手順本文に混入せず無視される", () => {
    const md = `# レシピ

## 材料
- 塩 | 少々 | |

## 手順
1. 切る。
###仕上げ
2. 盛り付ける。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input } = recipes[0];
    expect(input.steps).toHaveLength(2);
    expect(input.steps[0].instruction).toBe("切る。");
    expect(input.steps[1].instruction).toBe("盛り付ける。");
  });

  it("D3: 強調付きの材料行('|'を含む)は捨てずに材料として解釈する", () => {
    const md = `# レシピ

## 材料
**塩** | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input } = recipes[0];
    expect(input.ingredients).toHaveLength(1);
    expect(input.ingredients[0]).toMatchObject({
      name: "塩",
      quantity: "少々",
    });
  });

  it("D3: '|'を含まない強調だけの行は今までどおり警告して無視する", () => {
    const md = `# レシピ

## 材料
**煮汁**
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, warnings } = recipes[0];
    expect(input.ingredients).toHaveLength(1);
    expect(
      warnings.some((w) => w.includes("材料として解釈できませんでした: **煮汁**")),
    ).toBe(true);
  });

  // --- メタデータ(カテゴリ・タグ)の推測もれをプレビューで気づけるようにする警告 ---

  it("カテゴリが空のときはwarningを出す(登録はブロックしない)", () => {
    const md = `# レシピ
- タグ: 2026-09-27, ナス

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, warnings, errors } = recipes[0];
    expect(input.category).toBeNull();
    expect(warnings.some((w) => w.includes("カテゴリが空です"))).toBe(true);
    expect(errors.category).toBeUndefined();
  });

  it("タグが空のときはwarningを出す(登録はブロックしない)", () => {
    const md = `# レシピ
- カテゴリ: 主菜

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, warnings, errors } = recipes[0];
    expect(input.tags).toEqual([]);
    expect(warnings.some((w) => w.includes("タグが空です"))).toBe(true);
    expect(errors.tags).toBeUndefined();
  });

  it("カテゴリ・タグが埋まっていればそれらのwarningは出ない", () => {
    const md = `# レシピ
- カテゴリ: 主菜
- タグ: 2026-09-27, ナス, 炒め物

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { warnings } = recipes[0];
    expect(warnings.some((w) => w.includes("カテゴリが空です"))).toBe(false);
    expect(warnings.some((w) => w.includes("タグが空です"))).toBe(false);
  });

  it("カテゴリが7種類の語彙外のときはwarningを出す(登録はブロックしない)", () => {
    const md = `# レシピ
- カテゴリ: スープ
- タグ: 2026-09-27, しめじ, 煮物

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, warnings, errors } = recipes[0];
    expect(input.category).toBe("スープ");
    expect(
      warnings.some((w) => w.includes("カテゴリが語彙外です") && w.includes("スープ")),
    ).toBe(true);
    expect(errors.category).toBeUndefined();
  });

  it("カテゴリが7種類の語彙内ならwarningを出さない", () => {
    const md = `# レシピ
- カテゴリ: デザート
- タグ: 2026-09-27, りんご, 焼き物

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { warnings } = recipes[0];
    expect(warnings.some((w) => w.includes("語彙外"))).toBe(false);
  });

  it("人数・調理時間が空でもwarningは出さない(手直し時に空でも自然なため)", () => {
    const md = `# レシピ
- カテゴリ: 主菜
- タグ: 2026-09-27, ナス, 炒め物

## 材料
- 塩 | 少々 | |

## 手順
1. 味付けする。
`;
    const { recipes } = parseRecipeTemplate(md);
    const { input, warnings } = recipes[0];
    expect(input.servings).toBeNull();
    expect(input.cookingTimeMinutes).toBeNull();
    // カテゴリ・タグは埋まっているため、人数・調理時間が空でも警告は一切出ない。
    expect(warnings).toEqual([]);
  });
});
