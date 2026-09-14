/**
 * レシピ手順本文に埋め込む独自のテクニック参照記法を扱う。
 *
 * 記法: `[[techniqueId|表示語句]]`
 * - id が空、表示語句が空、`|` が無い、閉じ `]]` が無い等の壊れたマーカーは
 *   プレーンテキストとして扱う(記法として解釈しない)。
 */

export type InstructionSegment =
  | { type: "text"; text: string }
  | { type: "technique"; techniqueId: string; displayText: string };

interface MarkerMatch {
  start: number;
  end: number; // exclusive
  techniqueId: string;
  displayText: string;
}

const MARKER_RE = /\[\[([^[\]]*)\]\]/g;

/** 有効な(壊れていない)マーカーの位置と内容を、出現順にすべて返す。 */
function findValidMarkers(text: string): MarkerMatch[] {
  const markers: MarkerMatch[] = [];
  const re = new RegExp(MARKER_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const inner = match[1];
    const sepIndex = inner.indexOf("|");
    if (sepIndex <= 0) continue; // "|" が無い、または id が空

    const techniqueId = inner.slice(0, sepIndex).trim();
    const displayText = inner.slice(sepIndex + 1);
    if (techniqueId.length === 0 || displayText.length === 0) continue;

    markers.push({
      start: match.index,
      end: match.index + match[0].length,
      techniqueId,
      displayText,
    });
  }
  return markers;
}

export function parseInstruction(text: string): InstructionSegment[] {
  const markers = findValidMarkers(text);
  const segments: InstructionSegment[] = [];
  let lastIndex = 0;

  for (const marker of markers) {
    if (marker.start > lastIndex) {
      segments.push({
        type: "text",
        text: text.slice(lastIndex, marker.start),
      });
    }
    segments.push({
      type: "technique",
      techniqueId: marker.techniqueId,
      displayText: marker.displayText,
    });
    lastIndex = marker.end;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }

  return segments;
}

/** 本文中に出現するテクニックIDを重複なく、出現順で返す。 */
export function extractTechniqueIds(text: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const segment of parseInstruction(text)) {
    if (segment.type === "technique" && !seen.has(segment.techniqueId)) {
      seen.add(segment.techniqueId);
      ids.push(segment.techniqueId);
    }
  }
  return ids;
}

/**
 * [start, end) の選択範囲を `[[techniqueId|選択文字列]]` に置き換える。
 * 選択が空、範囲外、または既存の有効なマーカーと重なる場合は元のテキストをそのまま返す。
 */
export function wrapSelection(
  text: string,
  start: number,
  end: number,
  techniqueId: string,
): string {
  if (start < 0 || end > text.length || start >= end) {
    return text;
  }

  const markers = findValidMarkers(text);
  const overlaps = markers.some((m) => start < m.end && end > m.start);
  if (overlaps) {
    return text;
  }

  const selected = text.slice(start, end);
  return `${text.slice(0, start)}[[${techniqueId}|${selected}]]${text.slice(end)}`;
}

/** マーカーを表示語句に置き換えたプレーンテキストを返す。 */
export function stripMarkers(text: string): string {
  return parseInstruction(text)
    .map((segment) =>
      segment.type === "technique" ? segment.displayText : segment.text,
    )
    .join("");
}
