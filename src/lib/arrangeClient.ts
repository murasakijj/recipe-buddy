import { authHeader, ApiError } from "./apiClient";
import type { ArrangedRecipe } from "./types";

/** POST /api/arrange のリクエストボディ recipe 部分(docs/api.md)。 */
export interface ArrangeRequestRecipe {
  title: string;
  description: string | null;
  servings: string | null;
  cookingTimeMinutes: number | null;
  ingredients: {
    name: string;
    quantity: string | null;
    unit: string | null;
    note: string | null;
  }[];
  steps: { instruction: string }[];
}

export interface ArrangeRequestTechnique {
  id: string;
  name: string;
  summary: string | null;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? "unknown_error";
}

export async function requestArrangement(
  recipe: ArrangeRequestRecipe,
  techniques: ArrangeRequestTechnique[],
  request: string,
): Promise<ArrangedRecipe> {
  const headers = await authHeader();
  const res = await fetch("/api/arrange", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ recipe, techniques, request }),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await readError(res));
  }
  return (await res.json()) as ArrangedRecipe;
}
