import type { ApiRequest, ApiResponse } from "./_lib/types.js";
import { requireAuth, AuthError } from "./_lib/auth.js";
import { sendJson } from "./_lib/http.js";

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

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error("[api] unhandled", err);
    sendJson(res, 500, { error: "internal_error" });
  }
}
