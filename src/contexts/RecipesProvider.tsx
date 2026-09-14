import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  createRecipe,
  deleteRecipe,
  listRecipes,
  updateRecipe,
} from "../lib/recipes";
import type { Recipe, RecipeInput } from "../lib/types";
import { useAuth } from "./useAuth";
import { RecipesContext } from "./recipes-context";

export function RecipesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // RecipesProvider は RequireAuth 配下でのみ描画されるため、
  // マウント後の user は基本的に非nullが保証される。
  const uid = user?.uid;

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 初回読み込みは effect 内で reload() を直接呼ばず、Promise チェーンの
  // コールバック内で setState する(effect本体で直接 setState しない)。
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    listRecipes(uid)
      .then((list) => {
        if (cancelled) return;
        setRecipes(list);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("レシピの読み込みに失敗しました。");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const reload = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      setRecipes(await listRecipes(uid));
    } catch {
      setError("レシピの読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [uid]);

  const create = useCallback(
    async (input: RecipeInput) => {
      if (!uid) throw new Error("not authenticated");
      const created = await createRecipe(uid, input);
      setRecipes((prev) => [created, ...prev]);
      return created;
    },
    [uid],
  );

  const update = useCallback(
    async (id: string, input: RecipeInput) => {
      if (!uid) throw new Error("not authenticated");
      const updated = await updateRecipe(uid, id, input);
      setRecipes((prev) => {
        const next = prev.map((r) => (r.id === id ? updated : r));
        next.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        return next;
      });
      return updated;
    },
    [uid],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!uid) throw new Error("not authenticated");
      await deleteRecipe(uid, id);
      // 親削除時は子が parentRecipeId=null に更新されるため、
      // ローカル状態を個別パッチせず読み直して最新化する。
      await reload();
    },
    [uid, reload],
  );

  return (
    <RecipesContext.Provider
      value={{ recipes, loading, error, reload, create, update, remove }}
    >
      {children}
    </RecipesContext.Provider>
  );
}
