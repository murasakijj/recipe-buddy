import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useTechniques } from "../contexts/useTechniques";
import { newId } from "../lib/id";
import type { TechniqueInput } from "../lib/types";

interface InstructionRow {
  id: string;
  text: string;
}

function emptyInstructionRow(): InstructionRow {
  return { id: newId(), text: "" };
}

export default function TechniqueEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    techniques,
    loading: techniquesLoading,
    error: techniquesError,
    reload,
    create,
    update,
  } = useTechniques();
  const isEditing = Boolean(id);
  const existing = id ? techniques.find((t) => t.id === id) : undefined;

  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [cautions, setCautions] = useState("");
  const [instructions, setInstructions] = useState<InstructionRow[]>([
    emptyInstructionRow(),
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 既存テクニックの読み込みが完了した(またはidが変わった)タイミングでフォームへ反映する。
  // useEffectではなく「レンダー中に条件付きでstateを更新する」パターンを使う。
  const [hydratedId, setHydratedId] = useState<string | undefined>(undefined);
  if (existing && hydratedId !== existing.id) {
    setHydratedId(existing.id);
    setName(existing.name);
    setSummary(existing.summary ?? "");
    setCautions(existing.cautions ?? "");
    setInstructions(
      existing.instructions.length > 0
        ? existing.instructions.map((text) => ({ id: newId(), text }))
        : [emptyInstructionRow()],
    );
  }

  function updateInstruction(rowId: string, value: string) {
    setInstructions((prev) =>
      prev.map((row) => (row.id === rowId ? { ...row, text: value } : row)),
    );
  }
  function addInstruction() {
    setInstructions((prev) => [...prev, emptyInstructionRow()]);
  }
  function removeInstruction(rowId: string) {
    setInstructions((prev) => prev.filter((row) => row.id !== rowId));
    setErrors((prev) => {
      const key = `instructions.${rowId}`;
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }
  function moveInstruction(index: number, dir: -1 | 1) {
    setInstructions((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const nextErrors: Record<string, string> = {};
    if (name.trim().length === 0) {
      nextErrors.name = "名称を入力してください。";
    }
    const trimmedRows = instructions.map((row) => ({
      id: row.id,
      text: row.text.trim(),
    }));
    const hasAnyInstruction = trimmedRows.some((row) => row.text.length > 0);
    if (!hasAnyInstruction) {
      nextErrors.instructions = "手順を1件以上入力してください。";
    } else {
      trimmedRows.forEach((row) => {
        if (row.text.length === 0) {
          nextErrors[`instructions.${row.id}`] = "手順を入力してください。";
        }
      });
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setSubmitError(null);
    const input: TechniqueInput = {
      name: name.trim(),
      summary: summary.trim().length > 0 ? summary.trim() : null,
      cautions: cautions.trim().length > 0 ? cautions.trim() : null,
      instructions: trimmedRows.map((row) => row.text),
    };

    try {
      if (id) {
        await update(id, input);
      } else {
        await create(input);
      }
      navigate("/techniques");
    } catch {
      setSubmitError("保存に失敗しました。");
      setSaving(false);
    }
  }

  if (isEditing) {
    if (techniquesLoading) {
      return (
        <AppShell>
          <p>読み込み中...</p>
        </AppShell>
      );
    }
    if (techniquesError) {
      return (
        <AppShell>
          <p role="alert">読み込みに失敗しました。</p>
          <button type="button" className="btn" onClick={() => void reload()}>
            再試行
          </button>
        </AppShell>
      );
    }
    if (!existing) {
      return (
        <AppShell>
          <p>テクニックが見つかりません。</p>
        </AppShell>
      );
    }
  }

  return (
    <AppShell>
      <h1>{isEditing ? "テクニックを編集" : "テクニックを新規登録"}</h1>
      <form onSubmit={(e) => void handleSubmit(e)} className="form">
        <div className="form-field">
          <label htmlFor="technique-name">名称</label>
          <input
            id="technique-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {errors.name && (
            <p className="field-error" role="alert">
              {errors.name}
            </p>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="technique-summary">要約</label>
          <input
            id="technique-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </div>

        <div className="form-field">
          <span>手順</span>
          {errors.instructions && (
            <p className="field-error" role="alert">
              {errors.instructions}
            </p>
          )}
          {instructions.map((row, i) => (
            <div key={row.id} className="row-editor">
              <textarea
                value={row.text}
                onChange={(e) => updateInstruction(row.id, e.target.value)}
                aria-label={`手順${i + 1}`}
              />
              {errors[`instructions.${row.id}`] && (
                <p className="field-error" role="alert">
                  {errors[`instructions.${row.id}`]}
                </p>
              )}
              <div className="row-editor-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => moveInstruction(i, -1)}
                  disabled={i === 0}
                  aria-label="上へ移動"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => moveInstruction(i, 1)}
                  disabled={i === instructions.length - 1}
                  aria-label="下へ移動"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => removeInstruction(row.id)}
                  disabled={instructions.length <= 1}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="btn" onClick={addInstruction}>
            手順を追加
          </button>
        </div>

        <div className="form-field">
          <label htmlFor="technique-cautions">注意点</label>
          <textarea
            id="technique-cautions"
            value={cautions}
            onChange={(e) => setCautions(e.target.value)}
          />
        </div>

        {submitError && (
          <p role="alert" className="field-error">
            {submitError}
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => navigate("/techniques")}
          >
            キャンセル
          </button>
        </div>
      </form>
    </AppShell>
  );
}
