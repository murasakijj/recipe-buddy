import { describe, it, expect, vi } from "vitest";
import { ApiError as GenAiApiError } from "@google/genai";
import { callGeminiWithRetry, toAiProviderError, AiProviderError } from "./ai.js";

/** テスト用の即時解決sleep(実際には待たない。呼び出し回数・引数だけ記録する)。 */
function fakeSleep(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  const sleep = (ms: number) => {
    calls.push(ms);
    return Promise.resolve();
  };
  return { sleep, calls };
}

/** 呼び出しごとに時刻を進める、テスト用のnow()。 */
function fakeClock(stepMs: number): () => number {
  let current = 0;
  return () => {
    const value = current;
    current += stepMs;
    return value;
  };
}

/** 呼び出しごとに指定した値を順に返す、テスト用のnow()。配列を使い切ったら最後の値を返し続ける。 */
function scriptedClock(values: number[]): () => number {
  let i = 0;
  return () => {
    const value = values[Math.min(i, values.length - 1)];
    i++;
    return value;
  };
}

function timeoutError(): Error {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  return err;
}

/** AbortSignalを無視して永久に解決しないPromiseを返す、ハングするSDK呼び出しの模倣。 */
function hangingAttempt(): Promise<never> {
  return new Promise<never>(() => {
    // 意図的に何もしない(resolve/rejectしない)。
  });
}

function overloadedError(): GenAiApiError {
  return new GenAiApiError({
    message: "high demand",
    status: 503,
  });
}

function rateLimitedError(): GenAiApiError {
  return new GenAiApiError({
    message: "rate limited",
    status: 429,
  });
}

function badRequestError(): GenAiApiError {
  return new GenAiApiError({
    message: "bad request",
    status: 400,
  });
}

describe("toAiProviderError", () => {
  it("503は overloaded に分類する(接続はできているため upstream_error とは区別する)", () => {
    const err = toAiProviderError(overloadedError(), "test");
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.message).toBe("overloaded");
    expect(err.statusCode).toBe(502);
  });

  it("429は rate_limited に分類する(既存どおり)", () => {
    const err = toAiProviderError(rateLimitedError(), "test");
    expect(err.message).toBe("rate_limited");
  });

  it("それ以外のステータスは upstream_error に分類する(既存どおり)", () => {
    const err = toAiProviderError(badRequestError(), "test");
    expect(err.message).toBe("upstream_error");
  });
});

describe("callGeminiWithRetry", () => {
  it("503が返っても指定回数までリトライし、成功したら結果を返す", async () => {
    const { sleep, calls } = fakeSleep();
    let callCount = 0;
    const attempt = vi.fn(async () => {
      callCount++;
      if (callCount < 3) throw overloadedError();
      return "ok";
    });

    const result = await callGeminiWithRetry(attempt, {
      logTag: "test",
      sleep,
      now: fakeClock(1_000),
    });

    expect(result).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(3);
    // 2回リトライしたので、2回分の待機が発生する。
    expect(calls).toHaveLength(2);
    // N5: バックオフの実際の値を検証する(回数だけだと1秒→3秒のスケジュールが
    // 誤って例えば30秒になっていても検知できず、デッドライン超過に直結するため)。
    expect(calls[0]).toBeGreaterThanOrEqual(1_000);
    expect(calls[0]).toBeLessThanOrEqual(1_300);
    expect(calls[1]).toBeGreaterThanOrEqual(3_000);
    expect(calls[1]).toBeLessThanOrEqual(3_300);
  });

  it("3回とも503なら overloaded の AiProviderError を投げる", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw overloadedError();
    });

    await expect(
      callGeminiWithRetry(attempt, {
        logTag: "test",
        sleep,
        now: fakeClock(1_000),
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "overloaded",
    });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("429も同様にリトライされ、最終的に rate_limited になる", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw rateLimitedError();
    });

    await expect(
      callGeminiWithRetry(attempt, {
        logTag: "test",
        sleep,
        now: fakeClock(1_000),
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "rate_limited",
    });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("400系はリトライせず1回で終わる", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw badRequestError();
    });

    await expect(
      callGeminiWithRetry(attempt, {
        logTag: "test",
        sleep,
        now: fakeClock(1_000),
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "upstream_error",
    });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("残り時間が12秒未満のときはリトライしない", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw overloadedError();
    });

    // deadlineMsを50秒とし、1回目の試行だけで残りが12秒未満になるよう
    // nowを大きく進める(1回目の呼び出しで39秒経過→残り11秒)。
    let called = 0;
    const now = () => {
      const value = called === 0 ? 0 : 39_000;
      called++;
      return value;
    };

    await expect(
      callGeminiWithRetry(attempt, {
        logTag: "test",
        deadlineMs: 50_000,
        sleep,
        now,
      }),
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "overloaded",
    });
    // 残り時間不足でリトライを諦めるため、1回しか呼ばれない。
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("成功した1回目でリトライは発生しない", async () => {
    const { sleep, calls } = fakeSleep();
    const attempt = vi.fn(async () => "ok");

    const result = await callGeminiWithRetry(attempt, {
      logTag: "test",
      sleep,
      now: fakeClock(1_000),
    });

    expect(result).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it("N6: 残りがちょうど12000msのときはリトライする(境界値)", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw overloadedError();
    });
    // startedAt=0, i=0 remaining計算=0(remaining=50000), attempt1失敗,
    // remainingAfterFailure計算=38000(remaining=12000=ちょうど境界→リトライする),
    // i=1 remaining計算=38000(remaining=12000>0→attempt2実行), attempt2失敗,
    // remainingAfterFailure計算=45000(remaining=5000<12000→ここで諦める)。
    const now = scriptedClock([0, 0, 38_000, 38_000, 45_000]);

    await expect(
      callGeminiWithRetry(attempt, {
        logTag: "test",
        deadlineMs: 50_000,
        sleep,
        now,
      }),
    ).rejects.toMatchObject({ statusCode: 502, message: "overloaded" });
    // 12000ms境界でリトライが発生したので2回呼ばれる(3回目までは届かない)。
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("N6: 残りが11999msのときはリトライしない(境界値)", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw overloadedError();
    });
    // remainingAfterFailure計算で remaining=11999(<12000)になるようにする。
    const now = scriptedClock([0, 0, 38_001]);

    await expect(
      callGeminiWithRetry(attempt, {
        logTag: "test",
        deadlineMs: 50_000,
        sleep,
        now,
      }),
    ).rejects.toMatchObject({ statusCode: 502, message: "overloaded" });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("N7: タイムアウト(TimeoutError)はリトライ対象にならず1回で終わる", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(async () => {
      throw timeoutError();
    });

    await expect(
      callGeminiWithRetry(attempt, {
        logTag: "test",
        sleep,
        now: fakeClock(1_000),
      }),
    ).rejects.toMatchObject({ statusCode: 502, message: "upstream_error" });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("N1: attemptがAbortSignalを無視してハングしても、デッドラインで強制的に打ち切られる", async () => {
    const { sleep } = fakeSleep();
    const attempt = vi.fn(() => hangingAttempt());
    const startedAt = Date.now();

    // deadlineMsを実時間20msにし、attemptが(signalを無視して)永久にハングしても
    // raceWithDeadlineが強制的に打ち切ることを確認する(nowは実クロックのまま)。
    await expect(
      callGeminiWithRetry(attempt, { logTag: "test", deadlineMs: 20, sleep }),
    ).rejects.toMatchObject({ statusCode: 502, message: "upstream_error" });

    // 20msのデッドラインに対し、CIのゆらぎを見込んでも十分小さい時間で打ち切られる
    // はず(仮にsignal頼みで打ち切れず本当にハングしていたらこのテスト自体が
    // タイムアウトする)。
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    // ステータス不明の中断はリトライ対象外なので1回で終わる。
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("N3: 直前に503を観測していれば、リトライがデッドラインで中断されても overloaded に分類する", async () => {
    const { sleep } = fakeSleep();
    let callCount = 0;
    const attempt = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        // 1回目は本物の503(過負荷)。
        return Promise.reject(overloadedError());
      }
      // 2回目はAbortSignalを無視してハングする(=raceWithDeadlineの
      // デッドラインによって打ち切られる)実装を模す。
      return hangingAttempt();
    });

    // now()呼び出し順: 1)startedAt 2)i=0 remaining 3)i=0 remainingAfterFailure
    // 4)i=1 remaining。4回目だけ残りを実時間15msまで詰め、2回目の試行が
    // raceWithDeadlineによって高速に(実時間で)打ち切られるようにする。
    const now = scriptedClock([0, 0, 1_000, 49_985]);

    await expect(
      callGeminiWithRetry(attempt, {
        logTag: "test",
        deadlineMs: 50_000,
        sleep,
        now,
      }),
    ).rejects.toMatchObject({ statusCode: 502, message: "overloaded" });
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
