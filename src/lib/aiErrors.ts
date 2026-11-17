/**
 * AI呼び出し(/api/arrange・/api/import-*)の 429 系エラーの扱い(2026-11-17)。
 * - `quota_exhausted`: 無料枠の1日上限。待っても当日中は回復しない。
 * - `rate_limited`: 分単位などの一時的な制限。
 * どちらもサーバーが `retryAfterSec`(分かる場合のみ)を返す。
 * UI部品に依存しない純粋関数だけを置く(テスト容易性のため firebase 等を import しない)。
 */

export const QUOTA_EXHAUSTED = "quota_exhausted";
export const RATE_LIMITED = "rate_limited";

/** 秒数を「約◯時間◯分」「約◯分」「約◯秒」にする(切り上げ)。 */
export function formatRetryAfter(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  if (s < 60) return `約${Math.max(s, 1)}秒`;
  const totalMinutes = Math.ceil(s / 60);
  if (totalMinutes < 60) return `約${totalMinutes}分`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `約${hours}時間` : `約${hours}時間${minutes}分`;
}

export function quotaExhaustedMessage(retryAfterSec?: number): string {
  const head = "本日のAI利用回数の上限（無料枠）に達しました。";
  return retryAfterSec === undefined
    ? `${head}しばらく時間をおいて再度お試しください。`
    : `${head}${formatRetryAfter(retryAfterSec)}後に再度お試しください。`;
}

export function rateLimitedMessage(retryAfterSec?: number): string {
  const head = "AIの利用上限に達した可能性があります。";
  return retryAfterSec === undefined
    ? `${head}しばらくしてから再試行してください。`
    : `${head}${formatRetryAfter(retryAfterSec)}後に再試行してください。`;
}

/** 429系のコードなら案内文を返す。それ以外は null(呼び出し側の文言表を使う)。 */
export function rateLimitMessageFor(
  code: string,
  retryAfterSec?: number,
): string | null {
  if (code === QUOTA_EXHAUSTED) return quotaExhaustedMessage(retryAfterSec);
  if (code === RATE_LIMITED) return rateLimitedMessage(retryAfterSec);
  return null;
}

/** 以降のAI呼び出しを止めるべきエラー(日次上限・レート制限)かどうか。 */
export function isHaltingAiError(
  err: unknown,
): err is Error & { retryAfterSec?: number } {
  return (
    err instanceof Error &&
    (err.message === QUOTA_EXHAUSTED || err.message === RATE_LIMITED)
  );
}

export interface SequentialOutcome<R> {
  /** 成功した項目(元の並び順)。 */
  done: { index: number; value: R }[];
  /** 通常のエラーで失敗した項目(中断の原因になったものは含まない)。 */
  failed: { index: number; error: unknown }[];
  /**
   * 未処理の項目の index(昇順)。中断の原因になった項目自体と、それ以降の
   * 呼ばれなかった項目。中断が無ければ空。
   */
  unprocessed: number[];
  /** 中断の原因(quota_exhausted / rate_limited)。無ければ null。 */
  halted: (Error & { retryAfterSec?: number }) | null;
}

/**
 * `items` を1件ずつ順に処理する。通常のエラーはその項目だけ失敗として記録して
 * 続行するが、`quota_exhausted` / `rate_limited` を受けたら以降は呼ばずに止める
 * (自動で待って再開はしない)。成功済みの結果は捨てない。
 */
export async function runUntilHalt<T, R>(
  items: readonly T[],
  run: (item: T, index: number) => Promise<R>,
  onError?: (error: unknown, index: number) => void,
): Promise<SequentialOutcome<R>> {
  const outcome: SequentialOutcome<R> = {
    done: [],
    failed: [],
    unprocessed: [],
    halted: null,
  };
  for (let i = 0; i < items.length; i++) {
    if (outcome.halted) {
      outcome.unprocessed.push(i);
      continue;
    }
    try {
      outcome.done.push({ index: i, value: await run(items[i], i) });
    } catch (error) {
      onError?.(error, i);
      if (isHaltingAiError(error)) {
        outcome.halted = error;
        outcome.unprocessed.push(i);
      } else {
        outcome.failed.push({ index: i, error });
      }
    }
  }
  return outcome;
}

/**
 * 複数ファイル処理が429系で中断したときの表示文。原因の案内に続けて、
 * 処理済み・未処理のファイル名を示す。
 */
export function haltSummary(
  code: string,
  retryAfterSec: number | undefined,
  processed: readonly string[],
  unprocessed: readonly string[],
): string {
  const parts = [rateLimitMessageFor(code, retryAfterSec) ?? ""];
  parts.push(
    processed.length > 0
      ? `整形済み: ${processed.join("、")}。`
      : "整形済み: なし。",
  );
  if (unprocessed.length > 0) {
    parts.push(`未処理: ${unprocessed.join("、")}。`);
  }
  return parts.filter((p) => p.length > 0).join(" ");
}

/** 分類が上限で中断し、一部のレシピが未判定のときの案内。 */
export function unjudgedMessage(count: number, total: number): string {
  return `${total}件中${count}件は未判定です（「カテゴリ・タグをもう一度判定」で後から判定できます）。`;
}
