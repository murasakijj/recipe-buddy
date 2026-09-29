import { Type, type Schema } from "@google/genai";
import { IMPORT_CLASSIFY_SYSTEM_PROMPT, buildClassifyUserMessage } from "./classify-prompt.js";
import type { ClassifyRecipeInput } from "./classify-schema.js";
import {
  getClient,
  getModel,
  AiProviderError,
  callGeminiWithRetry,
  logGeminiSuccess,
  TIMEOUT_MS,
} from "../ai.js";

/** ClassifiedMetadataRaw(classify-schema.ts)の配列に対応する Gemini responseSchema。 */
const RESULT_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    category: { type: Type.STRING, nullable: true },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
    servings: { type: Type.STRING, nullable: true },
    cookingTimeMinutes: { type: Type.NUMBER, nullable: true },
  },
  required: ["category", "tags", "servings", "cookingTimeMinutes"],
};

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    results: { type: Type.ARRAY, items: RESULT_SCHEMA },
  },
  required: ["results"],
};

/**
 * Gemini にレシピ一覧の分類(カテゴリ・タグ・人数・調理時間の推測)をリクエストし、
 * JSONとしてパースした生の値を返す。スキーマ検証(zod)は呼び出し側
 * (api/import-classify.ts)の責務。タイムアウト・クライアント生成・エラー正規化・
 * リトライは api/_lib/arrange/gemini.ts, api/_lib/import/gemini.ts と共通(api/_lib/ai.ts)。
 */
export async function generateClassification(
  recipes: ClassifyRecipeInput[],
): Promise<unknown> {
  const client = getClient();
  const model = getModel();

  const response = await callGeminiWithRetry(
    (signal) =>
      client.models.generateContent({
        model,
        config: {
          systemInstruction: IMPORT_CLASSIFY_SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          abortSignal: signal,
        },
        contents: [
          { role: "user", parts: [{ text: buildClassifyUserMessage(recipes) }] },
        ],
      }),
    { logTag: "import-classify", deadlineMs: TIMEOUT_MS, model },
  );
  logGeminiSuccess("import-classify", model, response);

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
