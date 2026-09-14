import { useEffect, useRef } from "react";
import type { Technique } from "../lib/types";

interface TechniqueModalProps {
  technique: Technique;
  onClose: () => void;
  /**
   * 閉じたときにフォーカスを戻す要素。iOSはタップでボタンにフォーカスを残さないため
   * `document.activeElement` はあてにならない。呼び出し側(StepText)がクリックされた
   * ボタン自身を明示的に渡す。
   */
  returnFocusTo?: HTMLElement | null;
}

export default function TechniqueModal({
  technique,
  onClose,
  returnFocusTo,
}: TechniqueModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  // 開いた瞬間のスクロール位置を保持し、閉じたときに復元する。
  useEffect(() => {
    const opener = returnFocusTo ?? null;
    const scrollY = window.scrollY;

    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      // openerがまだDOMに存在する場合のみフォーカス・スクロール位置を復元する
      // (一覧の再描画等でボタン自体が消えている場合にfocus()で例外にならないように)。
      if (opener && document.body.contains(opener)) {
        opener.focus();
        window.scrollTo(0, scrollY);
      }
    };
  }, [returnFocusTo]);

  // Esc・backdropクリックいずれも dialog の close イベントに集約される。
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) {
      dialogRef.current?.close();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="technique-modal"
      onClick={handleBackdropClick}
      aria-labelledby="technique-modal-title"
    >
      <div className="technique-modal-content">
        <h2 id="technique-modal-title">{technique.name}</h2>
        {technique.summary && (
          <p className="technique-modal-summary">{technique.summary}</p>
        )}
        <ol className="technique-modal-instructions">
          {technique.instructions.map((instruction, index) => (
            <li key={index}>{instruction}</li>
          ))}
        </ol>
        {technique.cautions && (
          <div className="technique-modal-cautions">
            <strong>注意点</strong>
            <p>{technique.cautions}</p>
          </div>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => dialogRef.current?.close()}
        >
          閉じる
        </button>
      </div>
    </dialog>
  );
}
