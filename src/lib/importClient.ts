import { authHeader, ApiError, readError } from "./apiClient";

/**
 * POST /api/import-normalize を呼び、自由書式のMarkdownを正規化テンプレートへ
 * 整形させる(docs/api.md、docs/decisions.md「Markdownインポート」)。
 */
export async function normalizeMarkdown(
  markdown: string,
  sourceName?: string,
): Promise<string> {
  const headers = await authHeader();
  const res = await fetch("/api/import-normalize", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(sourceName ? { markdown, sourceName } : { markdown }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await readError(res));
  }
  const data = (await res.json()) as { markdown: string };
  return data.markdown;
}
