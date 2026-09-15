import {
  GoogleGenAI,
  ApiError as GenAiApiError,
  Type,
  type Schema,
} from "@google/genai";
import { ARRANGE_SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";
import type { ArrangeRequestBody } from "./schema.js";

/**
 * 無料枠の対象モデル。GEMINI_MODEL 環境変数で上書き可能。
 * 2026-09-15: gemini-2.5-flash が新規ユーザー向けに提供終了したため
 * gemini-3.6-flash に変更(docs/decisions.md 参照)。
 */
const DEFAULT_MODEL = "gemini-3.6-flash";
/** Vercel の maxDuration(60秒)より先に自前の502を返すため、50秒で切る(docs/api.md)。 */
const TIMEOUT_MS = 50_000;

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

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return new GoogleGenAI({ apiKey });
}

const ingredientSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    quantity: { type: Type.STRING, nullable: true },
    unit: { type: Type.STRING, nullable: true },
    note: { type: Type.STRING, nullable: true },
  },
  required: ["name"],
};

const stepSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    instruction: { type: Type.STRING },
  },
  required: ["instruction"],
};

const newTechniqueCandidateSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    description: { type: Type.STRING },
  },
  required: ["name", "description"],
};

/** ArrangedRecipe(docs/api.md)に対応する Gemini responseSchema。 */
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    changeSummary: { type: Type.ARRAY, items: { type: Type.STRING } },
    ingredients: { type: Type.ARRAY, items: ingredientSchema },
    steps: { type: Type.ARRAY, items: stepSchema },
    safetyNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
    questions: { type: Type.ARRAY, items: { type: Type.STRING } },
    newTechniqueCandidates: {
      type: Type.ARRAY,
      items: newTechniqueCandidateSchema,
    },
  },
  required: [
    "title",
    "changeSummary",
    "ingredients",
    "steps",
    "safetyNotes",
    "questions",
    "newTechniqueCandidates",
  ],
};

function toAiProviderError(err: unknown): AiProviderError {
  // APIキーやリクエスト本文は出さず、原因追跡に必要な最小限だけ記録する。
  const e = err as { name?: unknown; status?: unknown; message?: unknown };
  console.error("[arrange] gemini error", {
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

/**
 * Gemini にアレンジ生成をリクエストし、JSONとしてパースした生の値を返す。
 * スキーマ検証(zod)は呼び出し側(api/arrange.ts)の責務。
 *
 * タイムアウトは AbortSignal.timeout() に一本化する(Node 18+ で利用可能。
 * このプロジェクトは Node 24 を対象とするため、Promise.race によるフォール
 * バックは持たない)。
 */
export async function generateArrangement(
  input: ArrangeRequestBody,
): Promise<unknown> {
  const client = getClient();
  const userMessage = buildUserMessage(
    input.recipe,
    input.techniques,
    input.request,
  );

  let response;
  try {
    response = await client.models.generateContent({
      model: getModel(),
      config: {
        systemInstruction: ARRANGE_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
    });
  } catch (err) {
    throw toAiProviderError(err);
  }

  const text = response.text;
  if (!text) {
    throw new AiProviderError(502, "invalid_ai_output");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AiProviderError(502, "invalid_ai_output");
  }
}
