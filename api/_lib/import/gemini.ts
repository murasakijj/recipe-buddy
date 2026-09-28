import { Type, type Schema } from "@google/genai";
import { IMPORT_NORMALIZE_SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";
import {
  getClient,
  getModel,
  AiProviderError,
  callGeminiWithRetry,
  TIMEOUT_MS,
} from "../ai.js";

/** { markdown: string } のみを受け取る、非常に単純なresponseSchema。 */
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    markdown: { type: Type.STRING },
  },
  required: ["markdown"],
};

/**
 * Gemini に Markdown の正規化(整形)をリクエストし、JSONとしてパースした生の値を返す。
 * スキーマ検証(zod)は呼び出し側(api/import-normalize.ts)の責務。
 * タイムアウト・クライアント生成・エラー正規化・リトライは api/_lib/arrange/gemini.ts
 * と共通(api/_lib/ai.ts)。429/503は最大3回まで自動でリトライする
 * (docs/decisions.md 2026-09-28)。
 */
export async function generateNormalizedMarkdown(
  markdown: string,
  sourceName?: string,
): Promise<unknown> {
  const client = getClient();

  const response = await callGeminiWithRetry(
    (signal) =>
      client.models.generateContent({
        model: getModel(),
        config: {
          systemInstruction: IMPORT_NORMALIZE_SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          abortSignal: signal,
        },
        contents: [
          { role: "user", parts: [{ text: buildUserMessage(markdown, sourceName) }] },
        ],
      }),
    { logTag: "import-normalize", deadlineMs: TIMEOUT_MS },
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
