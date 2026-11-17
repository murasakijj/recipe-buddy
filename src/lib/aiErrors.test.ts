import { describe, it, expect, vi } from "vitest";
import {
  formatRetryAfter,
  quotaExhaustedMessage,
  rateLimitedMessage,
  rateLimitMessageFor,
  isHaltingAiError,
  runUntilHalt,
  haltSummary,
} from "./aiErrors";

function apiLikeError(code: string, retryAfterSec?: number) {
  return Object.assign(new Error(code), { retryAfterSec });
}

describe("formatRetryAfter", () => {
  it.each([
    [0.2, "約1秒"],
    [30, "約30秒"],
    [59.1, "約1分"],
    [60, "約1分"],
    [61, "約2分"],
    [3540, "約59分"],
    [3541, "約1時間"],
    [3600, "約1時間"],
    [30367, "約8時間27分"],
    [7200, "約2時間"],
  ] as [number, string][])("%s秒 -> %s", (sec, expected) => {
    expect(formatRetryAfter(sec)).toBe(expected);
  });
});

describe("文言", () => {
  it("quota_exhausted: retryAfterSec あり", () => {
    expect(quotaExhaustedMessage(30367)).toBe(
      "本日のAI利用回数の上限（無料枠）に達しました。約8時間27分後に再度お試しください。",
    );
  });

  it("quota_exhausted: retryAfterSec なしは時間を省き、時刻の推測をしない", () => {
    expect(quotaExhaustedMessage()).toBe(
      "本日のAI利用回数の上限（無料枠）に達しました。しばらく時間をおいて再度お試しください。",
    );
  });

  it("rate_limited: 既存文言に秒数を添える", () => {
    expect(rateLimitedMessage()).toBe(
      "AIの利用上限に達した可能性があります。しばらくしてから再試行してください。",
    );
    expect(rateLimitedMessage(30)).toBe(
      "AIの利用上限に達した可能性があります。約30秒後に再試行してください。",
    );
  });

  it("rateLimitMessageFor は429系以外で null", () => {
    expect(rateLimitMessageFor("overloaded")).toBeNull();
    expect(rateLimitMessageFor("quota_exhausted", 60)).toContain("約1分後");
    expect(rateLimitMessageFor("rate_limited")).toContain("しばらくしてから");
  });
});

describe("isHaltingAiError", () => {
  it("quota_exhausted / rate_limited だけが中断対象", () => {
    expect(isHaltingAiError(apiLikeError("quota_exhausted"))).toBe(true);
    expect(isHaltingAiError(apiLikeError("rate_limited"))).toBe(true);
    expect(isHaltingAiError(apiLikeError("overloaded"))).toBe(false);
    expect(isHaltingAiError("quota_exhausted")).toBe(false);
  });
});

describe("runUntilHalt", () => {
  it("全件成功", async () => {
    const out = await runUntilHalt(["a", "b"], async (x) => x.toUpperCase());
    expect(out.done).toEqual([
      { index: 0, value: "A" },
      { index: 1, value: "B" },
    ]);
    expect(out.failed).toEqual([]);
    expect(out.unprocessed).toEqual([]);
    expect(out.halted).toBeNull();
  });

  it("通常のエラーは失敗として記録し、続行する", async () => {
    const run = vi.fn(async (x: string) => {
      if (x === "b") throw apiLikeError("overloaded");
      return x;
    });
    const out = await runUntilHalt(["a", "b", "c"], run);
    expect(run).toHaveBeenCalledTimes(3);
    expect(out.done.map((d) => d.index)).toEqual([0, 2]);
    expect(out.failed.map((f) => f.index)).toEqual([1]);
    expect(out.halted).toBeNull();
  });

  it("quota_exhausted を受けたら以降を呼ばず、成功済みは残す", async () => {
    const run = vi.fn(async (x: string) => {
      if (x === "b") throw apiLikeError("quota_exhausted", 30367);
      return x;
    });
    const out = await runUntilHalt(["a", "b", "c", "d"], run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(out.done).toEqual([{ index: 0, value: "a" }]);
    expect(out.unprocessed).toEqual([1, 2, 3]);
    expect(out.halted?.message).toBe("quota_exhausted");
    expect(out.halted?.retryAfterSec).toBe(30367);
  });

  it("rate_limited でも中断する(自動で待って再開しない)", async () => {
    const run = vi.fn(async () => {
      throw apiLikeError("rate_limited", 20);
    });
    const out = await runUntilHalt(["a", "b"], run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(out.unprocessed).toEqual([0, 1]);
  });

  it("通常の失敗の後に中断した場合、失敗は failed に残る", async () => {
    const out = await runUntilHalt(["a", "b", "c"], async (x) => {
      if (x === "a") throw apiLikeError("upstream_error");
      if (x === "b") throw apiLikeError("quota_exhausted");
      return x;
    });
    expect(out.failed.map((f) => f.index)).toEqual([0]);
    expect(out.unprocessed).toEqual([1, 2]);
  });
});

describe("haltSummary", () => {
  it("処理済み・未処理のファイルを示す", () => {
    expect(
      haltSummary("quota_exhausted", 3600, ["a.md"], ["b.md", "c.md"]),
    ).toBe(
      "本日のAI利用回数の上限（無料枠）に達しました。約1時間後に再度お試しください。 整形済み: a.md。 未処理: b.md、c.md。",
    );
  });

  it("処理済みが無ければ「なし」", () => {
    expect(haltSummary("rate_limited", undefined, [], ["a.md"])).toContain(
      "整形済み: なし。 未処理: a.md。",
    );
  });
});
