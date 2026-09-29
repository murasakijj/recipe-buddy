/**
 * 「正規化テンプレート」(docs/api.md, docs/decisions.md「Markdownインポート」)を
 * 決定的に解析し、`RecipeInput[]` に変換する純関数群。
 *
 * AI(/api/import-normalize)は自由書式のMarkdownをこのテンプレートに整形するだけで、
 * `RecipeInput` への変換自体はここで行う(AIの構造化出力だけに頼らないことで、
 * 誤変換をvitestで検出可能にする。docs/decisions.md参照)。
 *
 * この解析器は与えられたテンプレート文字列を最大限解釈し、想定外の行があっても
 * 例外を投げずwarningsに積んで処理を続ける(黙って情報を落とさない)。
 * 寛容に解釈する規則の一覧は docs/api.md「パーサの寛容な解釈規則」を参照。
 *
 * `normalizeLineEndings` / `unwrapOuterFence` / `computeFenceMask` と
 * `RECIPE_TITLE_RE` / `SECTION_HEADING_RE` / `METADATA_LINE_RE` は export して
 * `src/lib/recipeMetadataMerge.ts` からも使う(2026-09-29 再レビューA3)。
 * 以前は `recipeMetadataMerge.ts` がこの前処理ロジックを複製しており、
 * 出力全体がコードフェンスで包まれたときの「外側フェンスを外す」処理が
 * 複製側に無かったため、mergeが全行を「フェンス内」と誤判定してno-opになる
 * (分類結果が無言で反映されない)バグがあった。判定ロジックを一本化することで
 * 再発しない形にする。
 */
import { newId } from "./id";
import { validateRecipeInput, type ValidationErrors } from "./recipeValidation";
import type { IngredientInput, RecipeInput, StepInput } from "./types";

export interface ParsedRecipe {
  input: RecipeInput;
  warnings: string[];
  errors: ValidationErrors;
}

export interface ParseRecipeTemplateResult {
  recipes: ParsedRecipe[];
  /** どのレシピにも属さない全体的な警告(先頭の見出し外テキストなど)。 */
  warnings: string[];
}

// レシピ境界: "#" ひとつ + 空白 + 本文。"##" 以降とは区別する
// ("#" の直後に空白以外の "#" が続く行にはマッチしない)。
export const RECIPE_TITLE_RE = /^#\s+(.+?)\s*$/;
export const SECTION_HEADING_RE = /^##\s+(.+?)\s*$/;
// "## 材料"/"## 手順"/"## メモ" として認識されなかった、"#"始まりの行
// (例: "### 仕上げ"、空白の無い"###仕上げ"/"#仕上げ")を広く検出する。
const HEADING_LIKE_RE = /^#+/;
export const METADATA_LINE_RE = /^-\s*(.+?)\s*[:：]\s*(.*)$/;
// 材料の箇条書き記号は "-" / "*" / "・" を受け、記号直後の空白は省略可にする
// ("-塩 | ..." のような表記ゆれも黙って落とさず拾う)。
const INGREDIENT_BULLET_RE = /^[-*・]\s*(.*)$/;
// 手順番号は半角/全角数字 + "." / ")" / "。"。番号直後の空白は省略可だが、
// 省略された場合はテンプレート違反としてwarningを出す(parseStepLine参照)。
// 区切り文字の直後がさらに数字の場合(例: "0.5%", "1.5cm")は小数点であり
// 手順番号ではないので、否定先読みでマッチさせない(再レビューR1)。
const NUMBERED_STEP_RE = /^[0-9０-９]+[.)。](?![0-9０-９])(\s*)(.*)$/;
const BULLET_STEP_RE = /^-\s+(.*)$/;

type MetadataField =
  | "category"
  | "servings"
  | "cookingTimeMinutes"
  | "tags"
  | "description";

// AIに指示しているカテゴリの語彙(docs/decisions.md「メタデータの自動補完」)。
// RecipeListのカテゴリ絞り込み<select>は登録済みレシピから動的生成されるため、
// 語彙外の値が紛れ込むと表記ゆれで選択肢が断片化する。プロンプトだけでなく
// パーサ側でも取りこぼしを検知できるようwarningを出す(再レビューM4)。
const CATEGORY_VOCABULARY = [
  "主菜",
  "副菜",
  "汁物",
  "主食",
  "丼",
  "デザート",
  "その他",
];

const METADATA_KEY_MAP: Record<string, MetadataField> = {
  カテゴリ: "category",
  人数: "servings",
  調理時間: "cookingTimeMinutes",
  タグ: "tags",
  // 概要はAIには生成させない(プロンプトに含めない)。ユーザーが整形結果を
  // 手直しするときのための、パーサ側だけが受け付ける任意キー(docs/api.md)。
  概要: "description",
};

/** CRLF/CR を LF に統一し、先頭のBOMを取り除く。 */
export function normalizeLineEndings(markdown: string): string {
  let text = markdown;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * 入力全体が単一のコードフェンスで丸ごと包まれている場合(AIが
 * ```` ```markdown 本文``` ```` のように出力する典型的な失敗モード)、
 * 外側のフェンスの開始・終了行だけを取り除いて中身を返す(再レビューR3)。
 * 内側にさらにフェンスが含まれる場合(=単純な1枚包みではない)は対象外とし、
 * 何もしない。戻り値は元の行の内容を一切変更しない、連続した部分配列
 * (`lines.slice`)なので、これを使う側は行の中身をそのまま再利用できる
 * (recipeMetadataMerge.ts はこれを使って出力テキストを組み立てる)。
 */
export function unwrapOuterFence(lines: string[], warnings: string[]): string[] {
  let start = 0;
  while (start < lines.length && lines[start].trim().length === 0) start++;
  let end = lines.length - 1;
  while (end >= 0 && lines[end].trim().length === 0) end--;

  if (start >= end) return lines; // 空、または1行しかない

  const first = lines[start].trim();
  const last = lines[end].trim();
  if (!first.startsWith("```") || last !== "```") return lines;

  const inner = lines.slice(start + 1, end);
  const hasNestedFence = inner.some((l) => l.trim().startsWith("```"));
  if (hasNestedFence) return lines;

  warnings.push(
    "出力全体がコードフェンスで囲まれていたため、外側のフェンスだけ取り除いて解析しました。",
  );
  return inner;
}

/**
 * 各行がコードフェンス(```)の内側(フェンスの開始・終了行自体を含む)かどうかを
 * 示すマスクを返す(非破壊)。`src/lib/recipeMarkdown.ts` と
 * `src/lib/recipeMetadataMerge.ts` の両方がこれを使う(再レビューA3で共通化)。
 * - パーサは、このマスクで「フェンス内なので無視する行」を判定する
 *   (フェンスの中身を書き換え後のテキストへ戻す必要が無いため)。
 * - mergeは、同じマスクで「書き換えてよい行」を判定しつつ、フェンスの中身を
 *   一切書き換えずにそのまま出力テキストへ残す(非破壊である必要があるため)。
 * 閉じフェンスが無い場合・正常に閉じた場合、それぞれ1フェンスにつき1件
 * warningを出す(黙って無視しない)。
 */
export function computeFenceMask(lines: string[], warnings: string[]): boolean[] {
  const mask: boolean[] = new Array(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim().startsWith("```")) {
      const start = i;
      i++;
      let closed = false;
      while (i < lines.length) {
        if (lines[i].trim().startsWith("```")) {
          closed = true;
          break;
        }
        i++;
      }
      const end = closed ? i : lines.length - 1;
      for (let k = start; k <= end; k++) mask[k] = true;
      warnings.push(
        closed
          ? "コードフェンスを無視しました。"
          : "閉じフェンスが見つかりませんでした。以降を無視しました。",
      );
      if (closed) i++; // 閉じフェンス行を読み飛ばす
      continue;
    }
    i++;
  }
  return mask;
}

function normalizeField(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface ParsedMetadata {
  category: string | null;
  servings: string | null;
  cookingTimeMinutes: number | null;
  tags: string[];
  description: string | null;
}

/** `lines[start, end)` のうち `fenceMask` が立っていない行だけをメタデータ行として解釈する。 */
function parseMetadata(
  lines: string[],
  fenceMask: boolean[],
  start: number,
  end: number,
  warnings: string[],
): ParsedMetadata {
  const meta: ParsedMetadata = {
    category: null,
    servings: null,
    cookingTimeMinutes: null,
    tags: [],
    description: null,
  };
  const seenFields = new Set<MetadataField>();

  for (let i = start; i < end; i++) {
    if (fenceMask[i]) continue;
    const line = lines[i].trim();
    if (line.length === 0) continue;

    const match = line.match(METADATA_LINE_RE);
    if (!match) {
      warnings.push(`メタデータとして解釈できませんでした: ${line}`);
      continue;
    }

    const key = match[1].trim();
    const value = match[2].trim();
    const field = METADATA_KEY_MAP[key];
    if (!field) {
      warnings.push(`不明なメタデータ項目です（無視します）: ${key}`);
      continue;
    }

    if (seenFields.has(field)) {
      warnings.push(
        `重複したメタデータ項目です（後の値を採用します）: ${key}`,
      );
    }
    seenFields.add(field);

    switch (field) {
      case "category":
        meta.category = value.length > 0 ? value : null;
        break;
      case "servings":
        meta.servings = value.length > 0 ? value : null;
        break;
      case "cookingTimeMinutes": {
        if (value.length === 0) {
          meta.cookingTimeMinutes = null;
          break;
        }
        const numMatch = value.match(/^(\d+)/);
        if (numMatch) {
          meta.cookingTimeMinutes = Number(numMatch[1]);
        } else {
          meta.cookingTimeMinutes = null;
          warnings.push(`調理時間を数値として解釈できませんでした: ${value}`);
        }
        break;
      }
      case "tags": {
        const seen = new Set<string>();
        const tags: string[] = [];
        for (const t of value.split(/[,、]/)) {
          const trimmed = t.trim();
          if (trimmed.length === 0 || seen.has(trimmed)) continue;
          seen.add(trimmed);
          tags.push(trimmed);
        }
        meta.tags = tags;
        break;
      }
      case "description":
        meta.description = value.length > 0 ? value : null;
        break;
    }
  }

  return meta;
}

/**
 * 箇条書き記号を除いた「材料行の中身」から `IngredientInput` を組み立てる。
 * 強調記号("**")は装飾として使われることがあるため、ここで一括して除去する
 * (例: "**塩** | 少々 | |" の名前が "**塩**" のまま残らないようにする)。
 */
function addIngredientFromContent(
  rawContent: string,
  ingredients: IngredientInput[],
  warnings: string[],
): void {
  const content = rawContent.replace(/\*\*/g, "");

  if (!content.includes("|")) {
    const name = content.trim();
    warnings.push(
      `材料の区切り(|)が見つかりませんでした。名前のみとして扱います: ${name}`,
    );
    ingredients.push({ id: newId(), name, quantity: null, unit: null, note: null });
    return;
  }

  const parts = content.split("|");
  // 末尾の空フィールドは落とす(「名前 | 分量 | 単位 | 補足 |」のように、
  // 補足が空でなくても末尾に余分な"|"が付くAI/人手の表記ゆれを吸収する)。
  while (parts.length > 1 && parts[parts.length - 1].trim().length === 0) {
    parts.pop();
  }

  const name = (parts[0] ?? "").trim();
  const quantity = normalizeField(parts[1]);
  const unit = normalizeField(parts[2]);
  // 5個目以降のフィールドが残っていれば "|" ごと補足に連結する(補足自体に
  // "|" が含まれていた場合に情報を落とさないため)。
  const note =
    parts.length > 4
      ? normalizeField(parts.slice(3).join("|"))
      : normalizeField(parts[3]);

  ingredients.push({ id: newId(), name, quantity, unit, note });
}

function parseIngredientLine(
  line: string,
  ingredients: IngredientInput[],
  warnings: string[],
): void {
  const trimmed = line.trim();

  // "**煮汁**" のような強調だけの行は、先頭が箇条書き記号の "*" と区別が
  // つかない。ただし "|" を含む実在の材料行(例: "**塩** | 少々 | |"、
  // 箇条書き記号"-"が無いままAIが強調で名前を包んだ場合)まで捨てないよう、
  // "|" の有無で分岐する(再レビューD3)。
  if (trimmed.startsWith("**")) {
    if (!trimmed.includes("|")) {
      warnings.push(`材料として解釈できませんでした: ${trimmed}`);
      return;
    }
    addIngredientFromContent(trimmed, ingredients, warnings);
    return;
  }

  const match = trimmed.match(INGREDIENT_BULLET_RE);
  if (!match || match[1].trim().length === 0) {
    // 箇条書き記号が無い、または記号だけで中身が無い行は黙って捨てず警告する
    // (例: サブ見出し "調味料" など)。
    warnings.push(`材料として解釈できませんでした: ${trimmed}`);
    return;
  }

  addIngredientFromContent(match[1], ingredients, warnings);
}

/**
 * 手順行を1件処理する。数字始まりの新しい手順、"- " 箇条書き(warning付きで
 * 新しい手順として受理)、それ以外は直前の手順への継続行として半角スペースで
 * 連結する。`[[id|語句]]` 記法を含む本文はここでは一切分割・加工しない。
 *
 * @returns 更新後の「連結対象となる手順のインデックス」(steps配列内)
 */
function parseStepLine(
  line: string,
  steps: StepInput[],
  currentStepIndex: number,
  warnings: string[],
): number {
  const trimmed = line.trim();

  const numberedMatch = trimmed.match(NUMBERED_STEP_RE);
  // 本文が空(例: 継続行のつもりで書かれた"2。"だけの行)の場合は手順番号と
  // みなさない。空文字の手順をpushしてしまうと検証エラーになりレシピが
  // 丸ごと登録不可になるため、代わりに継続行として扱う(再レビューR2)。
  if (numberedMatch && numberedMatch[2].trim().length > 0) {
    const [, spacing, content] = numberedMatch;
    if (spacing.length === 0) {
      warnings.push(`手順番号の後にスペースを入れてください: ${trimmed}`);
    }
    steps.push({ id: newId(), instruction: content.trim() });
    return steps.length - 1;
  }

  const bulletMatch = trimmed.match(BULLET_STEP_RE);
  if (bulletMatch) {
    warnings.push(`手順は番号付き（1. 2. …）にしてください: ${trimmed}`);
    steps.push({ id: newId(), instruction: bulletMatch[1].trim() });
    return steps.length - 1;
  }

  if (currentStepIndex >= 0) {
    const prev = steps[currentStepIndex];
    steps[currentStepIndex] = {
      ...prev,
      instruction: `${prev.instruction} ${trimmed}`,
    };
    return currentStepIndex;
  }

  // 直前の手順が無いのに継続行らしき内容が来た場合、情報を落とさないよう
  // それ自体を最初の手順として扱う。
  steps.push({ id: newId(), instruction: trimmed });
  return steps.length - 1;
}

type SectionType = "ingredients" | "steps" | "memo" | "ignore";

interface ParsedSections {
  ingredients: IngredientInput[];
  steps: StepInput[];
  memo: string | null;
  warnings: string[];
}

/** `lines[start, end)` のうち `fenceMask` が立っていない行だけをセクション本文として解釈する。 */
function parseSections(
  lines: string[],
  fenceMask: boolean[],
  start: number,
  end: number,
): ParsedSections {
  const warnings: string[] = [];
  const ingredients: IngredientInput[] = [];
  const steps: StepInput[] = [];
  const memoLines: string[] = [];
  let current: SectionType | null = null;
  let currentStepIndex = -1;

  for (let i = start; i < end; i++) {
    // コードフェンスの中身は、材料・手順どのセクションに属していても
    // 本文として取り込まない。warningは computeFenceMask がグローバルに積み済み。
    if (fenceMask[i]) continue;

    const raw = lines[i];
    const trimmed = raw.trim();

    const headingMatch = raw.match(SECTION_HEADING_RE);
    if (headingMatch) {
      const heading = headingMatch[1].trim();
      if (heading.startsWith("材料")) {
        current = "ingredients";
      } else if (heading.startsWith("手順") || heading.startsWith("作り方")) {
        current = "steps";
        currentStepIndex = -1;
      } else if (heading.startsWith("メモ")) {
        current = "memo";
      } else {
        current = "ignore";
        warnings.push(`不明なセクションです（無視します）: ${heading}`);
      }
      continue;
    }

    if (trimmed.length === 0) continue;

    if (HEADING_LIKE_RE.test(trimmed)) {
      // "## 材料"/"## 手順"/"## メモ" として認識されなかった、"#"始まりの
      // 行(例: "### 仕上げ"、空白の無い"###仕上げ"/"#仕上げ")は、
      // 手順本文などへ混入させず警告のうえ無視する(再レビューD2)。
      warnings.push(`未対応の見出しレベルです（無視しました）: ${trimmed}`);
      continue;
    }

    if (current === "ingredients") {
      parseIngredientLine(raw, ingredients, warnings);
    } else if (current === "steps") {
      currentStepIndex = parseStepLine(raw, steps, currentStepIndex, warnings);
    } else if (current === "memo") {
      const memoMatch = trimmed.match(/^-\s+(.*)$/);
      memoLines.push(memoMatch ? memoMatch[1] : trimmed);
    }
    // current === "ignore" または未確定(セクション見出し前)の行は無視する。
  }

  return {
    ingredients,
    steps,
    memo: memoLines.length > 0 ? memoLines.join("\n") : null,
    warnings,
  };
}

/** 概要(メタデータの「概要」)とメモを、概要 → 空行 → メモ の順で連結する。 */
function combineDescriptionAndMemo(
  description: string | null,
  memo: string | null,
): string | null {
  if (description && memo) return `${description}\n\n${memo}`;
  if (description) return description;
  if (memo) return memo;
  return null;
}

/** `lines[startIdx, endIdx)` の1レシピ分の範囲を解析する。 */
function parseRecipeBlock(
  lines: string[],
  fenceMask: boolean[],
  startIdx: number,
  endIdx: number,
): ParsedRecipe {
  const warnings: string[] = [];

  const titleMatch = lines[startIdx].match(RECIPE_TITLE_RE);
  const title = titleMatch ? titleMatch[1] : "";

  let firstSectionIdx = endIdx;
  for (let i = startIdx + 1; i < endIdx; i++) {
    if (!fenceMask[i] && SECTION_HEADING_RE.test(lines[i])) {
      firstSectionIdx = i;
      break;
    }
  }

  const meta = parseMetadata(lines, fenceMask, startIdx + 1, firstSectionIdx, warnings);

  const sections = parseSections(lines, fenceMask, firstSectionIdx, endIdx);
  warnings.push(...sections.warnings);

  const description = combineDescriptionAndMemo(meta.description, sections.memo);

  // カテゴリ・タグはAIに必ず埋めるよう指示しているが(docs/decisions.md
  // 「Markdownインポート」)、取りこぼした場合にプレビュー画面で気づけるよう
  // warningを出す。登録をブロックする`errors`には入れない(空のままでも
  // 登録後の編集画面で設定できるため)。人数・調理時間は手直し時に空でも
  // 自然なので警告は出さない。
  if (meta.category === null) {
    warnings.push(
      "カテゴリが空です。登録後に編集画面で設定できます。",
    );
  } else if (!CATEGORY_VOCABULARY.includes(meta.category)) {
    // タグ側(調理法の語彙)は手直し時のノイズになるためwarningを出さないが、
    // カテゴリはRecipeListの絞り込み<select>を直接断片化させるため出す
    // (再レビューM4)。
    warnings.push(
      `カテゴリが語彙外です（${CATEGORY_VOCABULARY.join("/")}）: ${meta.category}`,
    );
  }
  if (meta.tags.length === 0) {
    warnings.push("タグが空です。登録後に編集画面で設定できます。");
  }

  const input: RecipeInput = {
    title,
    description,
    servings: meta.servings,
    cookingTimeMinutes: meta.cookingTimeMinutes,
    parentRecipeId: null,
    sourceType: "manual",
    arrangementRequest: null,
    category: meta.category,
    tags: meta.tags,
    imageUrl: null,
    safetyNotes: [],
    changeSummary: [],
    ingredients: sections.ingredients,
    steps: sections.steps,
  };

  const errors = validateRecipeInput(input);

  return { input, warnings, errors };
}

/**
 * 正規化テンプレートの文字列を解析し、`RecipeInput` の配列に変換する。
 * 1入力に複数レシピ("# レシピ名" の繰り返し)が含まれてよい。
 */
export function parseRecipeTemplate(markdown: string): ParseRecipeTemplateResult {
  const normalized = normalizeLineEndings(markdown);
  const globalWarnings: string[] = [];

  // 出力全体が1枚のコードフェンスで包まれている場合(AIの典型的な失敗モード)は、
  // 外側のフェンスだけ外してから処理する(再レビューR3)。
  const lines = unwrapOuterFence(normalized.split("\n"), globalWarnings);
  // フェンス内に "#" 始まりの行が含まれていても新しいレシピ/セクションの
  // 開始と誤認しないよう、行分割の直後に判定しておく(非破壊マスク)。
  const fenceMask = computeFenceMask(lines, globalWarnings);

  const titleIndices: number[] = [];
  lines.forEach((line, i) => {
    if (!fenceMask[i] && RECIPE_TITLE_RE.test(line)) titleIndices.push(i);
  });

  if (titleIndices.length === 0) {
    // フェンス関連のwarning等(globalWarnings)は捨てずに、原因調査できるよう
    // 「見出しが見つからない」メッセージと合わせて返す(再レビューR3)。
    return {
      recipes: [],
      warnings: [
        ...globalWarnings,
        "レシピの見出し（# レシピ名）が見つかりませんでした。整形結果を確認してください。",
      ],
    };
  }

  const firstTitleIndex = titleIndices[0];
  const hasPreamble = lines
    .slice(0, firstTitleIndex)
    .some((l) => l.trim().length > 0);
  if (hasPreamble) {
    globalWarnings.push(
      "最初のレシピ見出しより前に本文があります（無視しました）。",
    );
  }

  const recipes = titleIndices.map((startIdx, i) => {
    const endIdx =
      i + 1 < titleIndices.length ? titleIndices[i + 1] : lines.length;
    return parseRecipeBlock(lines, fenceMask, startIdx, endIdx);
  });

  return { recipes, warnings: globalWarnings };
}
