import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useRecipes } from "../contexts/useRecipes";
import {
  normalizeMarkdown,
  classifyRecipes,
  type ClassifyRecipeInput,
} from "../lib/importClient";
import { ApiError } from "../lib/apiClient";
import { parseRecipeTemplate, type ParsedRecipe } from "../lib/recipeMarkdown";
import {
  applyMetadataToTemplate,
  type ClassifiedMetadata,
} from "../lib/recipeMetadataMerge";
import { newId } from "../lib/id";

/** 分類APIに1回で渡すレシピ数の上限(api/_lib/import/classify-schema.tsと同じ)。 */
const CLASSIFY_CHUNK_SIZE = 20;

const ERROR_MESSAGES: Record<string, string> = {
  invalid_body:
    "入力内容を確認してください（1件あたりの文字数が長すぎる可能性があります）。",
  rate_limited:
    "AIの利用上限に達した可能性があります。しばらくしてから再試行してください。",
  overloaded:
    "AIが混み合っています。1〜2分おいてから再試行してください。",
  invalid_ai_output: "AIの応答を処理できませんでした。",
  upstream_error:
    "AIサービスに接続できませんでした。しばらくしてから再試行してください。",
  internal_error:
    "一時的な問題が発生しました。しばらくしてから再試行してください。",
  server_error:
    "サーバーでエラーが発生しました。しばらくしてから再試行してください。",
  network:
    "通信エラーが発生しました。ネットワーク状況を確認して再試行してください。",
  missing_token: "認証が必要です。再度ログインしてください。",
  invalid_token: "認証が必要です。再度ログインしてください。",
  forbidden: "アクセス権がありません。",
  not_authenticated: "ログインしてください。",
  empty_input: "テキストを貼り付けるか、.md ファイルを選択してください。",
  file_read_error: "ファイルの読み込みに失敗しました。",
};

const GENERIC_ERROR_MESSAGE = "整形に失敗しました。もう一度試してください。";

function errorMessageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? GENERIC_ERROR_MESSAGE;
}

/** サーバー側(api/_lib/import/schema.ts)と同じ上限。 */
const MARKDOWN_MAX_LENGTH = 30_000;

/** 一覧プレビュー用に、解析結果へUIキーを振ったもの。 */
interface RecipeRow {
  key: string;
  parsed: ParsedRecipe;
}

export default function RecipeImport() {
  const { create } = useRecipes();

  const [pastedText, setPastedText] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const [normalizing, setNormalizing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [normalizeErrorCode, setNormalizeErrorCode] = useState<string | null>(
    null,
  );
  const [failedSources, setFailedSources] = useState<string[]>([]);
  // 一度でも「AIで整形して読み込む」を実行したか。整形が全滅して
  // templateTextが空のままでも、2段目(手直し用テキストエリア)は
  // 表示し続ける必要があるため、templateTextの有無とは別に管理する。
  const [normalizeAttempted, setNormalizeAttempted] = useState(false);

  const [templateText, setTemplateText] = useState("");
  // 直近で実際にローカル解析した文字列。templateTextと一致しない間は
  // 「編集したのにまだ読み込み直していない」状態として扱う。
  const [lastParsedText, setLastParsedText] = useState<string | null>(null);
  const [rows, setRows] = useState<RecipeRow[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [hasParsedOnce, setHasParsedOnce] = useState(false);
  // 今回の解析結果(rows)に対して登録済みの行(row.key → 作成されたレシピid)。
  // 二重登録を防ぐため、登録できた行はチェックを外してこれ以上選択できない
  // ようにする。「この内容で読み込み直す」で rows が作り直されるたびに
  // row.key も再採番されるため、この状態はreparse()のたびにリセットされる。
  const [registeredMap, setRegisteredMap] = useState<Record<string, string>>(
    {},
  );
  // このページを開いてから(再解析をまたいで)登録したレシピ名 → 作成id。
  // レシピ名の重複は許可する(docs/decisions.md)ため登録自体はブロックしない
  // が、再解析で行が作り直されても「さっき登録した」ことが分かるよう、
  // タイトルをキーにしてセッション中は保持する(再レビューD4)。
  const [registeredTitles, setRegisteredTitles] = useState<
    Record<string, string>
  >({});

  const [registering, setRegistering] = useState(false);
  const [registerSummary, setRegisterSummary] = useState<string | null>(null);

  // 分類(カテゴリ・タグ・人数・調理時間の推測、/api/import-classify)の状態。
  // 整形とは別パスにしたため(docs/decisions.md「整形と分類を2パスに分けた」)、
  // 分類だけが失敗してもレシピの取り込み自体はブロックしない。
  const [classifying, setClassifying] = useState(false);
  const [classifyErrorCode, setClassifyErrorCode] = useState<string | null>(
    null,
  );

  const isStale = hasParsedOnce && templateText !== lastParsedText;

  const selectableCount = useMemo(
    () =>
      rows.filter(
        (row) =>
          selected[row.key] &&
          Object.keys(row.parsed.errors).length === 0 &&
          !registeredMap[row.key],
      ).length,
    [rows, selected, registeredMap],
  );

  /** テンプレート文字列をローカルパーサのみで解析し直し、一覧プレビューの状態を作り直す。 */
  function reparse(text: string) {
    const result = parseRecipeTemplate(text);
    const nextRows: RecipeRow[] = result.recipes.map((parsed) => ({
      key: newId(),
      parsed,
    }));
    const nextSelected: Record<string, boolean> = {};
    nextRows.forEach((row) => {
      const hasErrors = Object.keys(row.parsed.errors).length > 0;
      // errorsがあるレシピは既定でも選択できない(チェック不可)。
      // このセッションで既に同名のレシピを登録済みなら、二重登録の
      // 誤クリックを避けるため既定はチェックを外す(手動でチェックすれば
      // 再登録も可能。docs/decisions.md「レシピ名の重複は許可」)。
      const alreadyRegisteredThisSession = !!registeredTitles[
        row.parsed.input.title
      ];
      nextSelected[row.key] = !hasErrors && !alreadyRegisteredThisSession;
    });
    setRows(nextRows);
    setParseWarnings(result.warnings);
    setSelected(nextSelected);
    setRegisteredMap({});
    setHasParsedOnce(true);
    setLastParsedText(text);
    setRegisterSummary(null);
  }

  /**
   * `recipes`(ローカル解析結果)を分類APIにかけ、結果をテンプレート文字列に
   * 書き戻してから再解析する。20件を超える場合は分割して順に呼ぶ。分類が
   * (一部でも)失敗しても例外は投げず、失敗した分は `null`(=そのレシピは
   * 書き換えない)として扱い、レシピの取り込み自体は止めない。
   */
  async function classifyAndMergeInto(
    text: string,
    recipes: ParsedRecipe[],
  ): Promise<void> {
    if (recipes.length === 0) {
      reparse(text);
      return;
    }

    setClassifying(true);
    setClassifyErrorCode(null);
    setProgress("カテゴリ・タグを判定中...");

    const targets: ClassifyRecipeInput[] = recipes.map((r) => ({
      title: r.input.title,
      ingredients: r.input.ingredients.map((i) => i.name),
      steps: r.input.steps.map((s) => s.instruction),
    }));

    const results: (ClassifiedMetadata | null)[] = [];
    let lastErrorCode: string | null = null;
    for (let i = 0; i < targets.length; i += CLASSIFY_CHUNK_SIZE) {
      const chunk = targets.slice(i, i + CLASSIFY_CHUNK_SIZE);
      try {
        results.push(...(await classifyRecipes(chunk)));
      } catch (err) {
        console.error("[import] classify failed", err);
        lastErrorCode = err instanceof ApiError ? err.message : "network";
        // 失敗した分はnull(=そのレシピのメタデータは書き換えない)で埋め、
        // 他のチャンクが成功していれば活かす。
        results.push(...chunk.map(() => null));
      }
    }

    setProgress(null);
    setClassifying(false);
    setClassifyErrorCode(lastErrorCode);

    const merged = applyMetadataToTemplate(text, results);
    setTemplateText(merged);
    reparse(merged);
  }

  /** 「カテゴリ・タグをもう一度判定」ボタン。整形はやり直さず、現在のテキストから分類だけ再実行する。 */
  async function handleReclassify() {
    if (classifying || normalizing || registering) return;
    const parsed = parseRecipeTemplate(templateText);
    await classifyAndMergeInto(templateText, parsed.recipes);
  }

  async function handleNormalize() {
    // 二重送信ガード。ArrangeInput(src/pages/ArrangeInput.tsx)と同じ流儀で、
    // awaitを挟む前に真っ先にチェック・フラグ更新する。
    if (normalizing || classifying) return;

    setNormalizing(true);
    setNormalizeErrorCode(null);
    setFailedSources([]);
    setProgress(null);

    // sourceNameはファイル名のときだけ渡す(貼り付けテキストは日付タグの
    // フォールバックに使えるファイル名を持たないため。再レビューM2)。
    const sources: { label: string; text: string; sourceName?: string }[] = [];
    const pasted = pastedText.trim();
    if (pasted.length > 0) {
      sources.push({ label: "貼り付けテキスト", text: pasted });
    }

    const fileReadFailures: string[] = [];
    for (const file of files) {
      try {
        const text = await file.text();
        if (text.length > MARKDOWN_MAX_LENGTH) {
          // サーバー側の上限(api/_lib/import/schema.ts)を超えるとどのみち
          // 400 invalid_body になるだけなので、送信前に分かるようにする
          // (再レビューD7)。
          fileReadFailures.push(
            `${file.name}（${MARKDOWN_MAX_LENGTH}文字を超えています）`,
          );
          continue;
        }
        sources.push({ label: file.name, text, sourceName: file.name });
      } catch (err) {
        console.error("[import] file read failed", file.name, err);
        fileReadFailures.push(file.name);
      }
    }

    if (sources.length === 0) {
      setNormalizing(false);
      setFailedSources(fileReadFailures);
      setNormalizeErrorCode(
        fileReadFailures.length > 0 ? "file_read_error" : "empty_input",
      );
      return;
    }

    setNormalizeAttempted(true);

    const succeeded: string[] = [];
    const failed: string[] = [...fileReadFailures];
    let lastErrorCode: string | null = null;

    // 長い入力でAIの出力が途中で切れるのを避けるため、ファイルは1件ずつ順に呼ぶ
    // (docs/decisions.md「Markdownインポート」)。
    for (let i = 0; i < sources.length; i++) {
      setProgress(
        `${sources.length}件中${i + 1}件目を整形中...（${sources[i].label}）`,
      );
      try {
        succeeded.push(
          await normalizeMarkdown(sources[i].text, sources[i].sourceName),
        );
      } catch (err) {
        console.error("[import] normalize failed", sources[i].label, err);
        failed.push(sources[i].label);
        lastErrorCode = err instanceof ApiError ? err.message : "network";
      }
    }

    setProgress(null);
    setNormalizing(false);
    setFailedSources(failed);

    if (succeeded.length === 0) {
      // templateTextは書き換えない(再レビューR4)。1回目の整形に成功した後、
      // 手直ししてから再整形して全滅した場合に、手直し済みのテキストや
      // 前回の整形結果を消してしまうと復旧できなくなるため。
      setNormalizeErrorCode(lastErrorCode ?? "empty_input");
      return;
    }

    // 複数ファイル分は空行で連結して1つのテンプレートとして編集・解析できるようにする。
    const combined = succeeded.join("\n\n");
    setTemplateText(combined);
    // ローカル解析 → 分類API(まとめて1回、20件超は分割) → テンプレートへ反映 →
    // 再解析、の順で行う(docs/decisions.md「整形と分類を2パスに分けた」)。
    // 分類が失敗してもレシピ自体は取り込めるよう、classifyAndMergeInto内で
    // 例外を投げずreparse()まで進める。
    const parsed = parseRecipeTemplate(combined);
    await classifyAndMergeInto(combined, parsed.recipes);
  }

  function handleReparseOnly() {
    if (normalizing || registering || classifying) return;
    reparse(templateText);
  }

  function toggleSelected(key: string) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleRegister() {
    if (registering || isStale || classifying) return;
    const targets = rows.filter(
      (row) =>
        selected[row.key] &&
        Object.keys(row.parsed.errors).length === 0 &&
        !registeredMap[row.key],
    );
    if (targets.length === 0) return;

    setRegistering(true);
    setRegisterSummary(null);

    let successCount = 0;
    let failureCount = 0;
    const newlyRegistered: Record<string, string> = {};
    const newlyRegisteredTitles: Record<string, string> = {};
    // Firestore書き込みはRecipesProviderの状態更新を保つため、並行実行せず
    // 1件ずつawaitする(SC-09)。
    for (const row of targets) {
      try {
        const created = await create(row.parsed.input);
        successCount++;
        newlyRegistered[row.key] = created.id;
        newlyRegisteredTitles[row.parsed.input.title] = created.id;
      } catch (err) {
        console.error("[import] create failed", row.parsed.input.title, err);
        failureCount++;
      }
    }

    if (Object.keys(newlyRegistered).length > 0) {
      setRegisteredMap((prev) => ({ ...prev, ...newlyRegistered }));
      setRegisteredTitles((prev) => ({ ...prev, ...newlyRegisteredTitles }));
      // 登録できた行はチェックを外して二重登録できないようにする。
      // 失敗した行は選択を残し、そのまま再登録を試せるようにする。
      setSelected((prev) => {
        const next = { ...prev };
        Object.keys(newlyRegistered).forEach((key) => {
          next[key] = false;
        });
        return next;
      });
    }

    setRegistering(false);
    setRegisterSummary(
      failureCount > 0
        ? `${successCount}件登録しました（失敗 ${failureCount}件）。`
        : `${successCount}件登録しました。`,
    );
  }

  const normalizeErrorMessage = normalizeErrorCode
    ? errorMessageFor(normalizeErrorCode)
    : null;
  // 全滅時は「どのファイルが失敗したか」と「なぜ失敗したか」を1つのalertにまとめる
  // (別々に出すとrole="alert"が2つ並んでしまうため)。
  const normalizeAlertMessage =
    failedSources.length > 0
      ? `整形に失敗しました: ${failedSources.join("、")}${
          normalizeErrorMessage ? `（${normalizeErrorMessage}）` : ""
        }`
      : normalizeErrorMessage;

  return (
    <AppShell>
      <h1>Markdownから登録</h1>
      <p className="notice">
        自由な書式のレシピメモをAIが正規化テンプレートに整形し、その後はローカルで解析します。AIの整形結果は次のステップで手直ししてから読み込み直せます。混み合っているときは自動で再試行するため、1件あたり最大1分ほどかかることがあります。
      </p>

      <section className="form">
        <h2>1. 入力</h2>
        <p className="notice">
          1日分のレシピメモ（材料と作り方が書かれたもの）を渡してください。料理の索引や献立一覧のような表は解析できません。
        </p>
        <div className="form-field">
          <label htmlFor="import-paste">テキストを貼り付け</label>
          <textarea
            id="import-paste"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={8}
            maxLength={MARKDOWN_MAX_LENGTH}
            placeholder="レシピメモをそのまま貼り付けてください"
            disabled={normalizing || classifying}
          />
          <p className="char-counter">
            {pastedText.length} / {MARKDOWN_MAX_LENGTH}
          </p>
        </div>

        <div className="form-field">
          <label htmlFor="import-files">.md ファイルを選択（複数可）</label>
          <input
            id="import-files"
            type="file"
            accept=".md,.markdown,text/markdown"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            disabled={normalizing || classifying}
          />
          {files.length > 0 && (
            <p className="import-selected-files">
              {files.length}件選択中: {files.map((f) => f.name).join(", ")}
            </p>
          )}
        </div>

        {progress && (
          <p className="notice" aria-live="polite">
            {progress}
          </p>
        )}

        {normalizeAlertMessage && (
          <p className="field-error" role="alert">
            {normalizeAlertMessage}
          </p>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleNormalize()}
            disabled={normalizing || classifying}
          >
            {normalizing ? "整形中…" : classifying ? "判定中…" : "AIで整形して読み込む"}
          </button>
        </div>
      </section>

      {normalizeAttempted && (
        <section className="form">
          <h2>2. 整形結果</h2>
          <div className="form-field">
            <label htmlFor="import-template">
              正規化テンプレート（編集できます）
            </label>
            <textarea
              id="import-template"
              value={templateText}
              onChange={(e) => setTemplateText(e.target.value)}
              rows={16}
            />
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              onClick={handleReparseOnly}
              disabled={normalizing || registering || classifying}
            >
              この内容で読み込み直す
            </button>
          </div>
        </section>
      )}

      {hasParsedOnce && (
        <section className="form">
          <h2>3. 登録するレシピを選択</h2>

          {isStale && (
            <p className="notice notice-warning">
              テキストを編集しました。「この内容で読み込み直す」を押してから登録してください。
            </p>
          )}

          {classifyErrorCode && (
            <div className="notice notice-warning" role="alert">
              <p>
                カテゴリ・タグの自動設定に失敗しました。レシピ自体は取り込めています。
              </p>
              <p>{errorMessageFor(classifyErrorCode)}</p>
              <button
                type="button"
                className="btn"
                onClick={() => void handleReclassify()}
                disabled={classifying || normalizing || registering}
              >
                {classifying ? "判定中…" : "カテゴリ・タグをもう一度判定"}
              </button>
            </div>
          )}

          {parseWarnings.length > 0 && (
            <div className="notice notice-warning">
              <p>整形結果に関する警告:</p>
              <ul>
                {parseWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {rows.length === 0 && (
            <p className="empty-state">
              解析できるレシピが見つかりませんでした。整形結果を確認してください。
            </p>
          )}

          <ul className="import-recipe-list">
            {rows.map((row) => {
              const errorMessages = Object.values(row.parsed.errors);
              const hasErrors = errorMessages.length > 0;
              const registeredId = registeredMap[row.key];
              // 「読み込み直す」で行が作り直された後も分かる、セッション中の
              // 登録履歴(タイトルで突き合わせるため、同名レシピが複数あると
              // 最後に登録したものを指す。あくまで目安表示)。
              const sessionRegisteredId =
                registeredTitles[row.parsed.input.title];
              return (
                <li key={row.key} className="card">
                  <label className="import-recipe-row">
                    <input
                      type="checkbox"
                      checked={
                        !!selected[row.key] && !hasErrors && !registeredId
                      }
                      disabled={hasErrors || registering || !!registeredId}
                      onChange={() => toggleSelected(row.key)}
                    />
                    <span className="import-recipe-title">
                      {row.parsed.input.title || "（タイトルなし）"}
                    </span>
                  </label>
                  <p className="recipe-card-meta">
                    材料 {row.parsed.input.ingredients.length} 件 / 手順{" "}
                    {row.parsed.input.steps.length} 件
                  </p>
                  {row.parsed.warnings.length > 0 && (
                    <ul className="import-recipe-warnings">
                      {row.parsed.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                  {hasErrors && (
                    <p className="field-error" role="alert">
                      登録できません: {errorMessages.join(" / ")}
                    </p>
                  )}
                  {registeredId ? (
                    <p className="import-recipe-registered">
                      登録済み:{" "}
                      <Link to={`/recipes/${registeredId}`}>レシピを見る</Link>
                    </p>
                  ) : (
                    sessionRegisteredId && (
                      <p className="import-recipe-registered">
                        このセッションで登録済みです（同名で再登録もできます）:{" "}
                        <Link to={`/recipes/${sessionRegisteredId}`}>
                          レシピを見る
                        </Link>
                      </p>
                    )
                  )}
                </li>
              );
            })}
          </ul>

          {registerSummary && <p className="notice">{registerSummary}</p>}

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleRegister()}
              disabled={
                registering || isStale || classifying || selectableCount === 0
              }
            >
              {registering
                ? "登録中…"
                : `選択した${selectableCount}件を登録`}
            </button>
          </div>

          {registerSummary && (
            <p>
              <Link to="/">レシピ一覧へ</Link>
            </p>
          )}
        </section>
      )}
    </AppShell>
  );
}
