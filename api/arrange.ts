import type { ApiRequest, ApiResponse } from "./_lib/types.js";
import { requireAuth, AuthError } from "./_lib/auth.js";
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
    await requireAuth(req.headers.authorization);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "internal_error" });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const parsedBody = arrangeRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }

  let raw: unknown;
  try {
    raw = await generateArrangement(parsedBody.data);
  } catch (err) {
    if (err instanceof AiProviderError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "internal_error" });
    return;
  }

  try {
    const parsedResult = arrangedRecipeSchema.parse(raw);
    const knownTechniqueIds = new Set(
      parsedBody.data.techniques.map((t) => t.id),
    );
    const sanitized = sanitizeArrangedRecipe(
      parsedResult,
      knownTechniqueIds,
      parsedBody.data.recipe.title,
    );
    res.status(200).json(sanitized);
  } catch {
    // AI出力がスキーマに合わない、または材料・手順が結果的に0件になった場合。
    // 内部のスタック等は返さない。
    res.status(502).json({ error: "invalid_ai_output" });
  }
}
