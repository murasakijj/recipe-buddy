import { Type, type Schema } from "@google/genai";
import { IMPORT_NORMALIZE_SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";
import {
  getClient,
  getModel,
  AiProviderError,
  toAiProviderError,
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
 * タイムアウト・クライアント生成・エラー正規化は api/_lib/arrange/gemini.ts と共通(api/_lib/ai.ts)。
 */
export async function generateNormalizedMarkdown(
  markdown: string,
  sourceName?: string,
): Promise<unknown> {
  const client = getClient();

  let response;
  try {
    response = await client.models.generateContent({
      model: getModel(),
      config: {
        systemInstruction: IMPORT_NORMALIZE_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      },
      contents: [
        { role: "user", parts: [{ text: buildUserMessage(markdown, sourceName) }] },
      ],
    });
  } catch (err) {
    throw toAiProviderError(err, "import-normalize");
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
