import type { ApiRequest, ApiResponse } from "./_lib/types.js";
import { requireAuth, AuthError } from "./_lib/auth.js";
import { sendJson, readJsonBody } from "./_lib/http.js";
import { AiProviderError } from "./_lib/ai.js";
import {
  importNormalizeRequestSchema,
  importNormalizeResponseSchema,
} from "./_lib/import/schema.js";
import { generateNormalizedMarkdown } from "./_lib/import/gemini.js";

export default async function handler(
  req: ApiRequest,
  res: ApiResponse,
): Promise<void> {
  try {
    try {
      await requireAuth(req.headers.authorization);
    } catch (err) {
      if (err instanceof AuthError) {
        sendJson(res, err.statusCode, { error: err.message });
        return;
      }
      throw err;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const body = await readJsonBody(req);
    const parsedBody = importNormalizeRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      sendJson(res, 400, { error: "invalid_body" });
      return;
    }

    let raw: unknown;
    try {
      raw = await generateNormalizedMarkdown(parsedBody.data.markdown);
    } catch (err) {
      if (err instanceof AiProviderError) {
        sendJson(res, err.statusCode, { error: err.message });
        return;
      }
      throw err;
    }

    const parsedResult = importNormalizeResponseSchema.safeParse(raw);
    if (!parsedResult.success) {
      // AI出力がスキーマに合わない場合。レスポンスには内部情報を返さないが、
      // ログには原因を残す。
      console.error(
        "[import-normalize] invalid ai output",
        parsedResult.error.issues,
      );
      sendJson(res, 502, { error: "invalid_ai_output" });
      return;
    }

    sendJson(res, 200, parsedResult.data);
  } catch (err) {
    console.error("[api] unhandled", err);
    sendJson(res, 500, { error: "internal_error" });
  }
}
