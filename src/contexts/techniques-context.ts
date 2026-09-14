import { createContext } from "react";
import type { Technique, TechniqueInput } from "../lib/types";

export interface TechniquesContextValue {
  techniques: Technique[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  create: (input: TechniqueInput) => Promise<Technique>;
  update: (id: string, input: TechniqueInput) => Promise<Technique>;
  remove: (id: string) => Promise<void>;
}

export const TechniquesContext = createContext<
  TechniquesContextValue | undefined
>(undefined);
