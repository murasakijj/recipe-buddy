import { beforeEach, describe, expect, it } from "vitest";
import {
  clearArrangeSession,
  loadArrangeSession,
  saveArrangeSession,
} from "./arrangeSession";
import type { ArrangeSession } from "./types";

/**
 * vitestは environment: "node" で動くため、ブラウザの sessionStorage が
 * 無い。テストのために最小限のインメモリ実装を globalThis に生やす。
 */
function createFakeSessionStorage(): Storage {
  const store = new Map<string, string>();
  const fake = {
    getItem: (key: string) =>
      store.has(key) ? (store.get(key) ?? null) : null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  return fake as unknown as Storage;
}

describe("arrangeSession", () => {
  // 各テストの前に毎回作り直すことで、テスト間の状態漏れを防ぐ
  // (DOM libを含む本プロジェクトの型では sessionStorage は元々グローバルに
  // 宣言されているので、ここでは単純に上書きするだけでよい)。
  beforeEach(() => {
    globalThis.sessionStorage = createFakeSessionStorage();
  });

  it("save→loadで同じ内容を往復できる(resultあり)", () => {
    const session: ArrangeSession = {
      parentRecipeId: "r1",
      request: "玉ねぎがない",
      createdAt: "2026-09-14T00:00:00.000Z",
      result: {
        title: "アレンジ後",
        changeSummary: ["玉ねぎを削除"],
        ingredients: [{ name: "鮭", quantity: "2", unit: "切れ", note: null }],
        steps: [{ instruction: "焼く" }],
        safetyNotes: ["中まで火を通す"],
        questions: [],
        newTechniqueCandidates: [],
      },
    };
    saveArrangeSession(session);
    expect(loadArrangeSession("r1")).toEqual(session);
  });

  it("result: null のセッションも往復できる", () => {
    const session: ArrangeSession = {
      parentRecipeId: "r2",
      request: "要求",
      createdAt: "2026-09-14T00:00:00.000Z",
      result: null,
    };
    saveArrangeSession(session);
    expect(loadArrangeSession("r2")).toEqual(session);
  });

  it("clearArrangeSessionで消える", () => {
    saveArrangeSession({
      parentRecipeId: "r3",
      request: "x",
      createdAt: "2026-09-14T00:00:00.000Z",
      result: null,
    });
    clearArrangeSession("r3");
    expect(loadArrangeSession("r3")).toBeNull();
  });

  it("存在しないキーはnull", () => {
    expect(loadArrangeSession("does-not-exist")).toBeNull();
  });

  it("壊れたJSONはnullを返す", () => {
    sessionStorage.setItem("arrange:r4", "{not valid json");
    expect(loadArrangeSession("r4")).toBeNull();
  });

  it("resultの配列フィールドが欠けていても[]に丸める", () => {
    sessionStorage.setItem(
      "arrange:r5",
      JSON.stringify({
        parentRecipeId: "r5",
        request: "req",
        createdAt: "2026-09-14T00:00:00.000Z",
        result: { title: "タイトルのみ" },
      }),
    );
    expect(loadArrangeSession("r5")).toEqual({
      parentRecipeId: "r5",
      request: "req",
      createdAt: "2026-09-14T00:00:00.000Z",
      result: {
        title: "タイトルのみ",
        ingredients: [],
        steps: [],
        changeSummary: [],
        safetyNotes: [],
        questions: [],
        newTechniqueCandidates: [],
      },
    });
  });

  it("トップレベルの必須文字列フィールドが欠けているとnull", () => {
    sessionStorage.setItem(
      "arrange:r6",
      JSON.stringify({ request: "req", createdAt: "x", result: null }),
    );
    expect(loadArrangeSession("r6")).toBeNull();
  });

  it("resultがオブジェクトだがtitleが無いとセッション全体がnull", () => {
    sessionStorage.setItem(
      "arrange:r7",
      JSON.stringify({
        parentRecipeId: "r7",
        request: "req",
        createdAt: "x",
        result: { ingredients: [] },
      }),
    );
    expect(loadArrangeSession("r7")).toBeNull();
  });

  it("トップレベルが配列など非オブジェクトの場合はnull", () => {
    sessionStorage.setItem("arrange:r8", JSON.stringify([1, 2, 3]));
    expect(loadArrangeSession("r8")).toBeNull();
  });
});
