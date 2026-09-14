import { describe, it, expect } from "vitest";
import {
  parseInstruction,
  extractTechniqueIds,
  wrapSelection,
  stripMarkers,
} from "./techniqueMarkup";

describe("parseInstruction", () => {
  it("マーカーのないテキストは1つのtextセグメントになる", () => {
    expect(parseInstruction("玉ねぎを薄切りにする。")).toEqual([
      { type: "text", text: "玉ねぎを薄切りにする。" },
    ]);
  });

  it("マーカーをtechniqueセグメントとして分解する", () => {
    expect(parseInstruction("人参を[[tq_1|細切り]]にする。")).toEqual([
      { type: "text", text: "人参を" },
      { type: "technique", techniqueId: "tq_1", displayText: "細切り" },
      { type: "text", text: "にする。" },
    ]);
  });

  it("複数のマーカーを扱える", () => {
    expect(parseInstruction("[[a|A]]と[[b|B]]を混ぜる")).toEqual([
      { type: "technique", techniqueId: "a", displayText: "A" },
      { type: "text", text: "と" },
      { type: "technique", techniqueId: "b", displayText: "B" },
      { type: "text", text: "を混ぜる" },
    ]);
  });

  it("先頭・末尾がマーカーでも正しく分解する", () => {
    expect(parseInstruction("[[a|A]]")).toEqual([
      { type: "technique", techniqueId: "a", displayText: "A" },
    ]);
  });

  it("空文字は空配列になる", () => {
    expect(parseInstruction("")).toEqual([]);
  });

  it("| が無いマーカーはプレーンテキストとして扱う", () => {
    const text = "人参を[[tq_1細切り]]にする。";
    expect(parseInstruction(text)).toEqual([{ type: "text", text }]);
  });

  it("id が空のマーカーはプレーンテキストとして扱う", () => {
    const text = "人参を[[|細切り]]にする。";
    expect(parseInstruction(text)).toEqual([{ type: "text", text }]);
  });

  it("表示語句が空のマーカーはプレーンテキストとして扱う", () => {
    const text = "人参を[[tq_1|]]にする。";
    expect(parseInstruction(text)).toEqual([{ type: "text", text }]);
  });

  it("閉じられていないマーカーはプレーンテキストとして扱う", () => {
    const text = "人参を[[tq_1|細切りにする。";
    expect(parseInstruction(text)).toEqual([{ type: "text", text }]);
  });

  it("壊れたマーカーと有効なマーカーが混在してもよい", () => {
    const text = "[[bad]]と[[a|A]]";
    expect(parseInstruction(text)).toEqual([
      { type: "text", text: "[[bad]]と" },
      { type: "technique", techniqueId: "a", displayText: "A" },
    ]);
  });
});

describe("extractTechniqueIds", () => {
  it("重複を除いた出現順のIDを返す", () => {
    expect(extractTechniqueIds("[[a|A]]と[[b|B]]、また[[a|A2]]")).toEqual([
      "a",
      "b",
    ]);
  });

  it("マーカーが無ければ空配列", () => {
    expect(extractTechniqueIds("玉ねぎを切る")).toEqual([]);
  });

  it("壊れたマーカーは無視する", () => {
    expect(extractTechniqueIds("[[bad]]のみ")).toEqual([]);
  });
});

describe("wrapSelection", () => {
  it("選択範囲をマーカーに置き換える", () => {
    const text = "人参を細切りにする。";
    const start = text.indexOf("細切り");
    const end = start + "細切り".length;
    expect(wrapSelection(text, start, end, "tq_1")).toBe(
      "人参を[[tq_1|細切り]]にする。",
    );
  });

  it("選択が空(start===end)なら変更しない", () => {
    const text = "人参を細切りにする。";
    expect(wrapSelection(text, 3, 3, "tq_1")).toBe(text);
  });

  it("start > end なら変更しない", () => {
    const text = "人参を細切りにする。";
    expect(wrapSelection(text, 5, 3, "tq_1")).toBe(text);
  });

  it("範囲外なら変更しない", () => {
    const text = "短い";
    expect(wrapSelection(text, 0, 100, "tq_1")).toBe(text);
  });

  it("既存の有効なマーカーと重なる場合は変更しない", () => {
    const text = "人参を[[tq_1|細切り]]にする。";
    // "細切り" を含む範囲を再度選択
    const start = text.indexOf("細切り") - 1;
    const end = start + 3;
    expect(wrapSelection(text, start, end, "tq_2")).toBe(text);
  });

  it("既存マーカーの前後は独立して選択できる", () => {
    const text = "人参を[[tq_1|細切り]]にする。";
    const start = text.indexOf("にする");
    const end = start + "にする".length;
    expect(wrapSelection(text, start, end, "tq_2")).toBe(
      "人参を[[tq_1|細切り]][[tq_2|にする]]。",
    );
  });
});

describe("stripMarkers", () => {
  it("マーカーを表示語句だけのプレーンテキストにする", () => {
    expect(stripMarkers("人参を[[tq_1|細切り]]にする。")).toBe(
      "人参を細切りにする。",
    );
  });

  it("マーカーが無ければそのまま返す", () => {
    expect(stripMarkers("玉ねぎを切る")).toBe("玉ねぎを切る");
  });

  it("壊れたマーカーはそのまま残る", () => {
    expect(stripMarkers("[[bad]]のみ")).toBe("[[bad]]のみ");
  });
});
