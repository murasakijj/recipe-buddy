import type { ApiRequest, ApiResponse } from "./_lib/types.js";
import { requireAuth, AuthError } from "./_lib/auth.js";
import { sendJson, readJsonBody } from "./_lib/http.js";
import { AiProviderError } from "./_lib/ai.js";
import {
  importClassifyRequestSchema,
  importClassifyResponseRawSchema,
  sanitizeClassifiedMetadata,
} from "./_lib/import/classify-schema.js";
import { generateClassification } from "./_lib/import/classify-gemini.js";

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
    const parsedBody = importClassifyRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      sendJson(res, 400, { error: "invalid_body" });
      return;
    }

    let raw: unknown;
    try {
      raw = await generateClassification(parsedBody.data.recipes);
    } catch (err) {
      if (err instanceof AiProviderError) {
        sendJson(res, err.statusCode, { error: err.message });
        return;
      }
      throw err;
    }

    const parsedResult = importClassifyResponseRawSchema.safeParse(raw);
    if (
      !parsedResult.success ||
      parsedResult.data.results.length !== parsedBody.data.recipes.length
    ) {
      // AI出力がスキーマに合わない、またはrecipesと件数が一致しない場合。
      // レスポンスには内部情報を返さないが、ログには原因を残す。
      console.error(
        "[import-classify] invalid ai output",
        parsedResult.success
          ? `count mismatch: recipes=${parsedBody.data.recipes.length} results=${parsedResult.data.results.length}`
          : parsedResult.error.issues,
      );
      sendJson(res, 502, { error: "invalid_ai_output" });
      return;
    }

    sendJson(res, 200, {
      results: parsedResult.data.results.map(sanitizeClassifiedMetadata),
    });
  } catch (err) {
    console.error("[api] unhandled", err);
    sendJson(res, 500, { error: "internal_error" });
  }
}
