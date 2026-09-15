import type { ApiRequest, ApiResponse } from "./_lib/types.js";
import { requireAuth, AuthError } from "./_lib/auth.js";
import { sendJson, readJsonBody } from "./_lib/http.js";
import {
  arrangeRequestSchema,
  arrangedRecipeSchema,
  sanitizeArrangedRecipe,
} from "./_lib/arrange/schema.js";
import { generateArrangement, AiProviderError } from "./_lib/arrange/gemini.js";

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
    const parsedBody = arrangeRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      sendJson(res, 400, { error: "invalid_body" });
      return;
    }

    let raw: unknown;
    try {
      raw = await generateArrangement(parsedBody.data);
    } catch (err) {
      if (err instanceof AiProviderError) {
        sendJson(res, err.statusCode, { error: err.message });
        return;
      }
      throw err;
    }

    let sanitized;
    try {
      const parsedResult = arrangedRecipeSchema.parse(raw);
      const knownTechniqueIds = new Set(
        parsedBody.data.techniques.map((t) => t.id),
      );
      sanitized = sanitizeArrangedRecipe(
        parsedResult,
        knownTechniqueIds,
        parsedBody.data.recipe.title,
      );
    } catch {
      // AI出力がスキーマに合わない、または材料・手順が結果的に0件になった場合。
      // 内部のスタック等は返さない。
      sendJson(res, 502, { error: "invalid_ai_output" });
      return;
    }
    // 送信自体はtryの外(このsendJsonが万一失敗しても、二重送信で
    // ERR_HTTP_HEADERS_SENTを起こしてouterのcatchがさらに投げることはない
    // ようsendJson自体もheadersSent/writableEndedならno-opにしてある)。
    sendJson(res, 200, sanitized);
  } catch (err) {
    console.error("[api] unhandled", err);
    sendJson(res, 500, { error: "internal_error" });
  }
}
