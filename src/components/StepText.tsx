import { useMemo, useState } from "react";
import { parseInstruction } from "../lib/techniqueMarkup";
import type { Technique } from "../lib/types";
import TechniqueModal from "./TechniqueModal";

interface StepTextProps {
  text: string;
  techniques: Record<string, Technique>;
}

export default function StepText({ text, techniques }: StepTextProps) {
  const [activeTechniqueId, setActiveTechniqueId] = useState<string | null>(
    null,
  );
  const segments = useMemo(() => parseInstruction(text), [text]);
  // iOSはタップしてもボタンにフォーカスを残さないため、モーダル側で
  // document.activeElement に頼らずクリックされたボタンを明示的に渡す。
  // (renderでref.currentを読まないよう、stateとして保持する。)
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null);

  const activeTechnique = activeTechniqueId
    ? (techniques[activeTechniqueId] ?? null)
    : null;

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={index}>{segment.text}</span>;
        }
        const technique = techniques[segment.techniqueId];
        if (!technique) {
          return <span key={index}>{segment.displayText}</span>;
        }
        return (
          <button
            key={index}
            type="button"
            className="technique-link"
            onClick={(e) => {
              setOpener(e.currentTarget);
              setActiveTechniqueId(segment.techniqueId);
            }}
          >
            ［{segment.displayText}］
          </button>
        );
      })}
      {activeTechnique && (
        <TechniqueModal
          technique={activeTechnique}
          onClose={() => setActiveTechniqueId(null)}
          returnFocusTo={opener}
        />
      )}
    </>
  );
}
