/**
 * AI分類結果(カテゴリ・タグ・人数・調理時間)を、正規化テンプレートの文字列へ
 * 書き戻すための決定的な純関数(docs/decisions.md「整形と分類を2パスに分けた」)。
 *
 * テンプレート文字列そのものを書き換えることで、整形結果のテキストエリアが
 * 唯一の正であり続ける。「この内容で読み込み直す」でローカル再解析しても
 * 分類結果は(テキストに書き込まれているので)消えない。
 *
 * レシピ境界("# " 見出し)・セクション見出し("## ")・コードフェンスの判定は
 * `src/lib/recipeMarkdown.ts` が export する関数・正規表現を**そのまま使う**
 * (以前はここに同じロジックを複製していたが、出力全体がコードフェンスで
 * 包まれたときに「外側フェンスを外す」処理がこちら側に無く、全行を
 * 「フェンス内」と誤判定してno-opになる=分類結果が無言で反映されないバグが
 * あった。2026-09-29 再レビューA3。判定ロジックを一本化して再発を防ぐ)。
 */
import {
  normalizeLineEndings,
  unwrapOuterFence,
  computeFenceMask,
  RECIPE_TITLE_RE,
  SECTION_HEADING_RE,
  METADATA_LINE_RE,
} from "./recipeMarkdown";

/**
 * api/_lib/import/classify-schema.ts の `ClassifiedMetadata` と同じ形。
 * api/ と src/ の間ではimportしない方針のため、ここに独立して定義する。
 */
export interface ClassifiedMetadata {
  category: string | null;
  tags: string[];
  servings: string | null;
  cookingTimeMinutes: number | null;
}

type MetadataKey = "カテゴリ" | "人数" | "調理時間" | "タグ";
const METADATA_KEYS: readonly MetadataKey[] = ["カテゴリ", "人数", "調理時間", "タグ"];
/** タグの最大個数(api/_lib/import/classify-schema.tsと同じ上限)。 */
const MAX_TAGS = 5;

function splitTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of value.split(/[,、]/)) {
    const trimmed = t.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    tags.push(trimmed);
  }
  return tags;
}

function mergeTags(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const t of [...existing, ...incoming]) {
    const trimmed = t.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    merged.push(trimmed);
    if (merged.length >= MAX_TAGS) break;
  }
  return merged;
}

interface FoundLine {
  /** `lines` 配列内の絶対インデックス。 */
  index: number;
  /** ":"/"："の後ろの値(前後空白除去済み)。 */
  value: string;
}

/**
 * メタデータ領域(タイトル行の次〜最初の非フェンス"## "見出しの手前、
 * コードフェンス内を除く)から、4つのキーそれぞれの出現を探す。
 * 同じキーが複数回出てきた場合は**後勝ち**にする
 * (`src/lib/recipeMarkdown.ts` の `parseMetadata` と同じ意味論に合わせる。
 * 再レビューB1。以前は最初の出現を使っており、パーサ側の解釈とズレていた)。
 */
function findMetadataLines(
  lines: string[],
  fenceMask: boolean[],
  start: number,
  end: number,
): Partial<Record<MetadataKey, FoundLine>> {
  const found: Partial<Record<MetadataKey, FoundLine>> = {};
  for (let i = start; i < end; i++) {
    if (fenceMask[i]) continue;
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    const match = trimmed.match(METADATA_LINE_RE);
    if (!match) continue;
    const key = match[1].trim();
    if (!(METADATA_KEYS as readonly string[]).includes(key)) continue;
    const typedKey = key as MetadataKey;
    // 後勝ち: 既に見つかっていても上書きする。
    found[typedKey] = { index: i, value: match[2].trim() };
  }
  return found;
}

function buildLine(key: MetadataKey, value: string): string {
  return `- ${key}: ${value}`;
}

/**
 * 正規化テンプレートの文字列に、AI分類結果を書き戻す。
 *
 * - レシピブロックは出現順に `metadata` の対応する要素と対応させる。
 *   `metadata[i]` が存在しない(配列が短い)、または `null`(そのレシピの分類に
 *   失敗した)場合は、そのブロックには一切手を加えない(件数がズレても例外を
 *   投げない)。
 * - カテゴリ・人数・調理時間は、既に値が入っている行があれば上書きしない
 *   (元のMarkdownに書いてあった情報 > AIの推測)。重複行がある場合は
 *   後勝ち(最後に出てきた行)を基準にする。
 * - タグは、既存のタグ(日付など)と分類結果のタグをマージし、重複除去のうえ
 *   最大5個にする(タグだけは既存値があっても追記する)。
 * - 該当キーの行が無ければ、タイトル直後にカテゴリ→人数→調理時間→タグの順で
 *   まとめて挿入する。
 * - コードフェンス内、各レシピの`## `セクション(材料・手順・メモ)以降は
 *   一切変更しない。出力全体が1枚のコードフェンスで包まれている場合は、
 *   パーサと同じく外側のフェンスを外してから処理する(再レビューA3)。
 */
export function applyMetadataToTemplate(
  templateText: string,
  metadata: (ClassifiedMetadata | null)[],
): string {
  const normalized = normalizeLineEndings(templateText);
  // フェンス関連のwarningは、整形結果を最初に解析した時点(parseRecipeTemplate)
  // で既にユーザーへ表示済みのため、ここでは再度使わず捨てる。
  const discardedWarnings: string[] = [];
  const lines = unwrapOuterFence(normalized.split("\n"), discardedWarnings);
  const fenceMask = computeFenceMask(lines, discardedWarnings);

  const titleIndices: number[] = [];
  lines.forEach((line, i) => {
    if (!fenceMask[i] && RECIPE_TITLE_RE.test(line)) titleIndices.push(i);
  });

  // 後ろのレシピブロックから処理する(行を挿入すると、それより後ろの
  // インデックスがずれるため。前から処理すると自分より後ろのtitleIndicesが
  // 無効になってしまう)。
  for (let k = titleIndices.length - 1; k >= 0; k--) {
    const meta = metadata[k];
    if (!meta) continue;

    const titleIdx = titleIndices[k];
    const blockEnd = k + 1 < titleIndices.length ? titleIndices[k + 1] : lines.length;

    let firstSectionIdx = blockEnd;
    for (let i = titleIdx + 1; i < blockEnd; i++) {
      if (!fenceMask[i] && SECTION_HEADING_RE.test(lines[i])) {
        firstSectionIdx = i;
        break;
      }
    }

    const found = findMetadataLines(lines, fenceMask, titleIdx + 1, firstSectionIdx);
    const toInsert: string[] = [];

    // カテゴリ・人数・調理時間: 既存値があれば触らない。空欄(または未挿入)なら埋める。
    const scalarUpdates: [MetadataKey, string | null][] = [
      ["カテゴリ", meta.category],
      ["人数", meta.servings],
      [
        "調理時間",
        meta.cookingTimeMinutes !== null ? String(meta.cookingTimeMinutes) : null,
      ],
    ];
    for (const [key, incomingValue] of scalarUpdates) {
      const existing = found[key];
      if (existing) {
        if (existing.value.length === 0 && incomingValue) {
          lines[existing.index] = buildLine(key, incomingValue);
        }
        // 既に値がある場合は何もしない(上書きしない)。
      } else if (incomingValue) {
        toInsert.push(buildLine(key, incomingValue));
      }
    }

    // タグ: 既存タグ(あれば)と分類結果をマージする。
    const existingTagsLine = found["タグ"];
    const existingTags = existingTagsLine ? splitTags(existingTagsLine.value) : [];
    const merged = mergeTags(existingTags, meta.tags);
    if (existingTagsLine) {
      if (merged.length > 0 && merged.join(",") !== existingTags.join(",")) {
        lines[existingTagsLine.index] = buildLine("タグ", merged.join(", "));
      }
    } else if (merged.length > 0) {
      toInsert.push(buildLine("タグ", merged.join(", ")));
    }

    if (toInsert.length > 0) {
      lines.splice(titleIdx + 1, 0, ...toInsert);
    }
  }

  return lines.join("\n");
}
