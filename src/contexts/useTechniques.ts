import { useContext } from "react";
import { TechniquesContext } from "./techniques-context";

export function useTechniques() {
  const ctx = useContext(TechniquesContext);
  if (!ctx) {
    throw new Error("useTechniques must be used within TechniquesProvider");
  }
  return ctx;
}
