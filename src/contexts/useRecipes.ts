import { useContext } from "react";
import { RecipesContext } from "./recipes-context";

export function useRecipes() {
  const ctx = useContext(RecipesContext);
  if (!ctx) {
    throw new Error("useRecipes must be used within RecipesProvider");
  }
  return ctx;
}
