import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  createTechnique,
  deleteTechnique,
  listTechniques,
  updateTechnique,
} from "../lib/techniques";
import type { Technique, TechniqueInput } from "../lib/types";
import { useAuth } from "./useAuth";
import { TechniquesContext } from "./techniques-context";

export function TechniquesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // TechniquesProvider は RequireAuth 配下でのみ描画されるため、
  // マウント後の user は基本的に非nullが保証される。
  const uid = user?.uid;

  const [techniques, setTechniques] = useState<Technique[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 初回読み込みは effect 内で reload() を直接呼ばず、Promise チェーンの
  // コールバック内で setState する(effect本体で直接 setState しない)。
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    listTechniques(uid)
      .then((list) => {
        if (cancelled) return;
        setTechniques(list);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("テクニックの読み込みに失敗しました。");
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
      setTechniques(await listTechniques(uid));
    } catch {
      setError("テクニックの読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [uid]);

  const create = useCallback(
    async (input: TechniqueInput) => {
      if (!uid) throw new Error("not authenticated");
      const created = await createTechnique(uid, input);
      setTechniques((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "ja")),
      );
      return created;
    },
    [uid],
  );

  const update = useCallback(
    async (id: string, input: TechniqueInput) => {
      if (!uid) throw new Error("not authenticated");
      const updated = await updateTechnique(uid, id, input);
      setTechniques((prev) =>
        prev
          .map((t) => (t.id === id ? updated : t))
          .sort((a, b) => a.name.localeCompare(b.name, "ja")),
      );
      return updated;
    },
    [uid],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!uid) throw new Error("not authenticated");
      await deleteTechnique(uid, id);
      setTechniques((prev) => prev.filter((t) => t.id !== id));
    },
    [uid],
  );

  return (
    <TechniquesContext.Provider
      value={{ techniques, loading, error, reload, create, update, remove }}
    >
      {children}
    </TechniquesContext.Provider>
  );
}
