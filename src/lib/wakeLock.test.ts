import { describe, it, expect } from "vitest";
import { isWakeLockSupported, wakeLockStatusReducer } from "./wakeLock";

describe("isWakeLockSupported", () => {
  it("Node実行環境(navigator.wakeLockが無い)ではfalseを返す", () => {
    // vitestはNode環境で動く。Node組み込みのnavigatorにはwakeLockが無いため false になるはず。
    expect(isWakeLockSupported()).toBe(false);
  });
});

describe("wakeLockStatusReducer", () => {
  it("acquired で active になる", () => {
    expect(wakeLockStatusReducer("released", { type: "acquired" })).toBe(
      "active",
    );
  });

  it("pending から acquired で active になる(初期状態からの遷移)", () => {
    expect(wakeLockStatusReducer("pending", { type: "acquired" })).toBe(
      "active",
    );
  });

  it("pending から failed で failed になる", () => {
    expect(wakeLockStatusReducer("pending", { type: "failed" })).toBe("failed");
  });

  it("released で released になる", () => {
    expect(wakeLockStatusReducer("active", { type: "released" })).toBe(
      "released",
    );
  });

  it("failed で failed になる", () => {
    expect(wakeLockStatusReducer("active", { type: "failed" })).toBe("failed");
  });

  it("unsupported で unsupported になる", () => {
    expect(wakeLockStatusReducer("active", { type: "unsupported" })).toBe(
      "unsupported",
    );
  });

  it("一度 unsupported になったら他のイベントでは変化しない", () => {
    expect(wakeLockStatusReducer("unsupported", { type: "acquired" })).toBe(
      "unsupported",
    );
    expect(wakeLockStatusReducer("unsupported", { type: "failed" })).toBe(
      "unsupported",
    );
  });
});
