import { createContext } from "react";
import type { Recipe, RecipeInput } from "../lib/types";

export interface RecipesContextValue {
  recipes: Recipe[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (input: RecipeInput) => Promise<Recipe>;
  update: (id: string, input: RecipeInput) => Promise<Recipe>;
  remove: (id: string) => Promise<void>;
}

export const RecipesContext = createContext<RecipesContextValue | undefined>(
  undefined,
);
