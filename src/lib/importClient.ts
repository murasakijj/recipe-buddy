import { authHeader, ApiError, readError } from "./apiClient";
import type { ClassifiedMetadata } from "./recipeMetadataMerge";

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

/** POST /api/import-classify の1レシピ分のリクエスト(材料名・手順本文だけの軽い表現)。 */
export interface ClassifyRecipeInput {
  title: string;
  ingredients: string[];
  steps: string[];
}

/**
 * POST /api/import-classify を呼び、レシピ一覧のカテゴリ・タグ・人数・調理時間を
 * 推測させる(docs/api.md、docs/decisions.md「整形と分類を2パスに分けた」)。
 * `recipes` と同じ順序・同じ件数の配列を返す。
 */
export async function classifyRecipes(
  recipes: ClassifyRecipeInput[],
): Promise<ClassifiedMetadata[]> {
  const headers = await authHeader();
  const res = await fetch("/api/import-classify", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ recipes }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await readError(res));
  }
  const data = (await res.json()) as { results: ClassifiedMetadata[] };
  return data.results;
}
