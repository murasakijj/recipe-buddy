import { useEffect, useRef, useState } from "react";
import type { Technique } from "../lib/types";

interface TechniquePickerDialogProps {
  techniques: Technique[];
  onSelect: (techniqueId: string) => void;
  onClose: () => void;
  /** 閉じたときにフォーカスを戻す要素(紐づけ元の手順テキストエリアなど)。 */
  returnFocusTo?: HTMLElement | null;
}

export default function TechniquePickerDialog({
  techniques,
  onSelect,
  onClose,
  returnFocusTo,
}: TechniquePickerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const opener = returnFocusTo ?? null;
    const scrollY = window.scrollY;

    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (opener && document.body.contains(opener)) {
        opener.focus();
        window.scrollTo(0, scrollY);
      }
    };
  }, [returnFocusTo]);

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

  const filtered = techniques.filter(
    (t) => search.trim().length === 0 || t.name.includes(search.trim()),
  );

  return (
    <dialog
      ref={dialogRef}
      className="technique-picker"
      onClick={handleBackdropClick}
      aria-labelledby="technique-picker-title"
    >
      <div className="technique-picker-content">
        <h2 id="technique-picker-title">テクニックを選択</h2>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="テクニック名で検索"
          aria-label="テクニック名で検索"
        />
        {filtered.length === 0 && <p>該当するテクニックがありません。</p>}
        <ul className="technique-picker-list">
          {filtered.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onSelect(t.id);
                  dialogRef.current?.close();
                }}
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn"
          onClick={() => dialogRef.current?.close()}
        >
          キャンセル
        </button>
      </div>
    </dialog>
  );
}
