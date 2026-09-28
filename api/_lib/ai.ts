import { GoogleGenAI } from "@google/genai";

/**
 * Gemini呼び出しの共通処理(クライアント生成・モデル名解決・エラー正規化・リトライ)。
 * `api/_lib/arrange/gemini.ts` と `api/_lib/import/gemini.ts` の両方から使う
 * (docs/api.md「共通」)。
 */

/**
 * 無料枠の対象モデル。GEMINI_MODEL 環境変数で上書き可能。
 * 2026-09-15: gemini-2.5-flash が新規ユーザー向けに提供終了したため
 * gemini-3.6-flash に変更(docs/decisions.md 参照)。
 */
const DEFAULT_MODEL = "gemini-3.6-flash";
/**
 * Vercel の maxDuration(60秒)より先に自前で502を返すため、50秒で切る(docs/api.md)。
 * リトライを行う場合もこの50秒が呼び出し全体(初回+リトライ)のデッドラインになる
 * (callGeminiWithRetry参照)。
 */
export const TIMEOUT_MS = 50_000;

/** 各プロバイダ呼び出しが上流エラーを正規化して投げるための共通エラー型。money-lens api/_lib/ai/types.ts と同じ形。 */
export class AiProviderError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function getModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

export function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return new GoogleGenAI({ apiKey });
}

/** GenAiApiError由来のステータスコードを取り出す(duck-typingでも拾えるようにする)。 */
function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Gemini呼び出しの例外を `AiProviderError` に正規化する。
 * `logTag` はログの識別用プレフィックス(例: "arrange", "import-normalize")。
 * APIキーやリクエスト本文は出さず、原因追跡に必要な最小限だけ記録する。
 *
 * 429(レート制限)は "rate_limited"、503(モデル過負荷。2026-09-28 実際に発生した
 * "This model is currently experiencing high demand" 等)は "overloaded" に分類する。
 * どちらも「接続はできている」状態であり、"upstream_error"(接続できない)とは
 * 文言を分ける(docs/api.md参照)。
 *
 * 分類は `instanceof GenAiApiError` ではなく `statusOf`(duck-typing)を優先する
 * (再レビューN4)。callGeminiWithRetry のリトライ可否判定も同じ `statusOf` を
 * 使っており、SDKのバージョン差やラップで `instanceof` が外れても「503を
 * リトライした末に upstream_error と報告する」ような判定基準のズレが起きない
 * ようにするため。
 */
export function toAiProviderError(err: unknown, logTag: string): AiProviderError {
  const e = err as { name?: unknown; status?: unknown; message?: unknown };
  console.error(`[${logTag}] gemini error`, {
    name: e?.name,
    status: e?.status,
    message: e?.message,
  });

  const status = statusOf(err);
  if (status !== undefined) {
    const code =
      status === 429 ? "rate_limited" : status === 503 ? "overloaded" : "upstream_error";
    return new AiProviderError(502, code);
  }
  // AbortSignal.timeout() による中断は環境によって AbortError/TimeoutError
  // いずれの名前でも飛んでくるため、両方をタイムアウト扱いにする。
  if (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  ) {
    return new AiProviderError(502, "upstream_error");
  }
  return new AiProviderError(502, "upstream_error");
}

// --- リトライ(2026-09-28: 本番で503が頻発したため追加。docs/decisions.md参照) ---

/** 最大試行回数(初回+リトライ2回)。 */
const MAX_ATTEMPTS = 3;
/** リトライ対象のHTTPステータス。429(レート制限)と503(過負荷)だけ。400系や
 * それ以外の5xxは再試行しても直らないことが多いので即座にエラーを返す。 */
const RETRYABLE_STATUSES = new Set([429, 503]);
/** 試行1→2の待機、試行2→3の待機のバックオフ基準値(ミリ秒)。ジッターを別途足す。 */
const BACKOFF_SCHEDULE_MS = [1_000, 3_000];
/** ジッターの最大値(ミリ秒)。バックオフが揃って再試行が重ならないようにする。 */
const JITTER_MAX_MS = 300;
/**
 * 残りデッドラインがこの時間を切ったらリトライしない(次の試行がタイムアウトで
 * 終わるだけになるのを避ける)。
 */
const MIN_REMAINING_MS_FOR_RETRY = 12_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `promise` を、`ms`ミリ秒で強制的に失敗させる競走タイマーと `Promise.race` させる。
 * `client.models.generateContent` に渡す `AbortSignal` はSDK側の実装に協力を
 * 期待するものでしかなく、signalを無視する・中断が遅れるとデッドラインの歯止めが
 * 無くなる(再レビューN1: シミュレーションで最大77,041ms=Vercelの
 * `FUNCTION_INVOCATION_TIMEOUT`(60秒)超過を確認)。旧実装(リトライ導入前)から
 * この依存自体はあったが、リトライ導入で超過が最大3回分積み上がる構造になった
 * ため、SDKの挙動に依らずデッドラインを保証するラッパー側の最終防衛線として追加した。
 * タイマーがリークしないよう、いずれの分岐でも必ず `clearTimeout` する。
 */
function raceWithDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`gemini call exceeded ${ms}ms deadline`);
      err.name = "TimeoutError";
      reject(err);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 中断由来(AbortError/TimeoutError)のエラーかどうか。`raceWithDeadline` が
 * 生成した合成タイムアウトも、`AbortSignal.timeout()` によるものも同じ名前で
 * 飛んでくる(toAiProviderErrorのコメント参照)。
 */
function isAbortLike(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

/**
 * 最終的にthrowするエラーを組み立てる。ログ出力は常に`toAiProviderError`に委ねるが、
 * 直前までに429/503を観測していた(`lastRetryableStatus`)のに、そのリトライが
 * デッドラインで中断されて`AbortError`/`TimeoutError`として飛んできた場合は、
 * 中断由来の "upstream_error" ではなく、観測していたステータスの分類
 * ("overloaded"/"rate_limited")を優先する(再レビューN3)。
 * 実測: 503が38秒で返る→残り約11秒でリトライ→デッドラインで中断、という経路で
 * 最終エラーが"upstream_error"になり、過負荷という実態が伝わらない問題があった。
 */
function classifyFinalError(
  err: unknown,
  logTag: string,
  lastRetryableStatus: number | undefined,
): AiProviderError {
  const mapped = toAiProviderError(err, logTag);
  if (isAbortLike(err) && lastRetryableStatus !== undefined) {
    const code = lastRetryableStatus === 429 ? "rate_limited" : "overloaded";
    return new AiProviderError(mapped.statusCode, code);
  }
  return mapped;
}

export interface CallWithRetryOptions {
  /** ログの識別用プレフィックス(例: "arrange", "import-normalize")。 */
  logTag: string;
  /** 呼び出し全体(初回+リトライ)のデッドライン(ミリ秒)。既定はTIMEOUT_MS。 */
  deadlineMs?: number;
  /** テスト用の差し替え。既定は setTimeout ベースの実待機。 */
  sleep?: (ms: number) => Promise<void>;
  /** テスト用の差し替え。既定は Date.now。 */
  now?: () => number;
}

/**
 * Gemini呼び出しを実行し、429(レート制限)・503(過負荷)のときだけ最大3回まで
 * (初回+リトライ2回)リトライする。バックオフは1秒→3秒(+ジッター)。
 *
 * 呼び出し全体でVercelのmaxDuration(60秒)より先に自前でエラーを返すため、
 * `deadlineMs`(既定50秒)を守る: 各試行の`AbortSignal`にはその時点の残り時間を
 * 渡すだけでなく、`raceWithDeadline`で同じ残り時間の競走タイマーとも競わせて
 * 強制的に打ち切る(signalの伝播だけに頼らない。再レビューN1)。リトライ直前の
 * 残り時間が `MIN_REMAINING_MS_FOR_RETRY`(12秒)未満ならリトライせず直近の
 * エラーをそのまま返す。
 *
 * `attempt` は1回分の呼び出し(例: `client.models.generateContent`)を行う関数で、
 * その試行に使うべき `AbortSignal` を受け取る。
 */
export async function callGeminiWithRetry<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  options: CallWithRetryOptions,
): Promise<T> {
  const { logTag } = options;
  const deadlineMs = options.deadlineMs ?? TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const startedAt = now();

  let lastErr: unknown;
  // 直近に観測した429/503。デッドライン中断で分類を落とさないために覚えておく
  // (classifyFinalError参照。再レビューN3)。
  let lastRetryableStatus: number | undefined;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const remaining = deadlineMs - (now() - startedAt);
    if (remaining <= 0) {
      throw classifyFinalError(
        lastErr ?? new Error("deadline exceeded before attempt"),
        logTag,
        lastRetryableStatus,
      );
    }

    try {
      return await raceWithDeadline(attempt(AbortSignal.timeout(remaining)), remaining);
    } catch (err) {
      lastErr = err;
      const status = statusOf(err);
      const isRetryable = status !== undefined && RETRYABLE_STATUSES.has(status);
      if (isRetryable) {
        lastRetryableStatus = status;
      }
      const isLastAttempt = i === MAX_ATTEMPTS - 1;
      if (!isRetryable || isLastAttempt) {
        throw classifyFinalError(err, logTag, lastRetryableStatus);
      }

      const remainingAfterFailure = deadlineMs - (now() - startedAt);
      if (remainingAfterFailure < MIN_REMAINING_MS_FOR_RETRY) {
        throw classifyFinalError(err, logTag, lastRetryableStatus);
      }

      const backoff =
        BACKOFF_SCHEDULE_MS[i] ?? BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1];
      const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
      // 待機時間そのものでデッドラインを使い切らないよう、残り時間からも頭打ちする。
      // 現在の定数(MAX_ATTEMPTS=3, MIN_REMAINING_MS_FOR_RETRY=12_000)では
      // backoff+jitter(最大3,299ms)が remainingAfterFailure-1_000 を上回ることは
      // 無く、この頭打ちと`BACKOFF_SCHEDULE_MS[i] ?? …`のフォールバックは実際には
      // 到達しない防御的コード(再レビューN9)。定数を変更した場合の安全網として残す。
      const waitMs = Math.max(
        Math.min(backoff + jitter, remainingAfterFailure - 1_000),
        0,
      );
      // APIキーやリクエスト本文は出さず、再試行回数とステータスだけ記録する。
      console.error(
        `[${logTag}] gemini retry ${i + 1}/${MAX_ATTEMPTS - 1} after ${status}`,
      );
      await sleep(waitMs);
    }
  }

  // 上のループは必ずreturn/throwで抜けるが、TSの制御フロー解析のため明示しておく。
  throw classifyFinalError(lastErr, logTag, lastRetryableStatus);
}
