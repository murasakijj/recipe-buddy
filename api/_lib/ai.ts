import { GoogleGenAI, ApiError as GenAiApiError } from "@google/genai";

/**
 * Gemini呼び出しの共通処理(クライアント生成・モデル名解決・エラー正規化)。
 * `api/_lib/arrange/gemini.ts` と `api/_lib/import/gemini.ts` の両方から使う
 * (docs/api.md「共通」)。
 */

/**
 * 無料枠の対象モデル。GEMINI_MODEL 環境変数で上書き可能。
 * 2026-09-15: gemini-2.5-flash が新規ユーザー向けに提供終了したため
 * gemini-3.6-flash に変更(docs/decisions.md 参照)。
 */
const DEFAULT_MODEL = "gemini-3.6-flash";
/** Vercel の maxDuration(60秒)より先に自前の502を返すため、50秒で切る(docs/api.md)。 */
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

/**
 * Gemini呼び出しの例外を `AiProviderError` に正規化する。
 * `logTag` はログの識別用プレフィックス(例: "arrange", "import-normalize")。
 * APIキーやリクエスト本文は出さず、原因追跡に必要な最小限だけ記録する。
 */
export function toAiProviderError(err: unknown, logTag: string): AiProviderError {
  const e = err as { name?: unknown; status?: unknown; message?: unknown };
  console.error(`[${logTag}] gemini error`, {
    name: e?.name,
    status: e?.status,
    message: e?.message,
  });

  if (err instanceof GenAiApiError) {
    const code = err.status === 429 ? "rate_limited" : "upstream_error";
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
