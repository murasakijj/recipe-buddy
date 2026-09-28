import { Type, type Schema } from "@google/genai";
import { ARRANGE_SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";
import type { ArrangeRequestBody } from "./schema.js";
import {
  getClient,
  getModel,
  AiProviderError,
  callGeminiWithRetry,
  TIMEOUT_MS,
} from "../ai.js";

// getModel/AiProviderError は共通実装(api/_lib/ai.ts)に切り出し済み。
// 既存のimportパス(api/_lib/arrange/gemini.js から import している箇所・テスト)を
// 壊さないよう、ここから re-export しておく。
export { getModel, AiProviderError };

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

/**
 * Gemini にアレンジ生成をリクエストし、JSONとしてパースした生の値を返す。
 * スキーマ検証(zod)は呼び出し側(api/arrange.ts)の責務。
 *
 * タイムアウトは AbortSignal.timeout() に一本化する(Node 18+ で利用可能。
 * このプロジェクトは Node 24 を対象とするため、Promise.race によるフォール
 * バックは持たない)。429/503は `callGeminiWithRetry` が最大3回まで自動で
 * リトライする(docs/decisions.md 2026-09-28、api/_lib/ai.ts参照)。
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

  const response = await callGeminiWithRetry(
    (signal) =>
      client.models.generateContent({
        model: getModel(),
        config: {
          systemInstruction: ARRANGE_SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          abortSignal: signal,
        },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
      }),
    { logTag: "arrange", deadlineMs: TIMEOUT_MS },
  );

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
