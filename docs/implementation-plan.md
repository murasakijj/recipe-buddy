# 実装計画

仕様 §17 の推奨順（縦方向の小さな単位）に従う。各フェーズの受け入れ条件を満たしてから次へ。`npm run build`（tsc + vite build）と `npm test` が通る状態を保つ。

## Phase 0: 基盤・認証

- [x] Vite + React + TS の scaffold。money-lens と同じ tsconfig 構成（app / node / api）、eslint、prettier、vitest
- [x] `vercel.json`（SPA rewrite + `/api` + COOP ヘッダー）、`.env.example`、`.gitignore`
- [x] `api/_lib/types.ts`, `api/_lib/auth.ts`（+ テスト）, `api/auth-check.ts`
- [x] `src/lib/firebase.ts`（auth + firestore）、`AuthContext`、`RequireAuth`、`Login`
- [x] `firebase/firestore.rules`

受け入れ: ビルドとテストが通り、`/login` → Google ログイン → `/api/auth-check` 403 でアクセス拒否表示になる構造ができている。

## Phase 1: レシピ CRUD（FR-01〜FR-05）

- [x] `src/lib/types.ts`, `src/lib/recipes.ts`（list / get / create / update / remove、親削除時の子独立化）
- [x] RecipeList（検索・カテゴリ・タグ絞り込み、親子バッジ）
- [x] RecipeDetail（親リンク・子一覧・操作ボタン）
- [x] RecipeEdit（材料・手順の追加・削除・並び替え、必須チェック、失敗時に入力保持）

受け入れ: §13-1, 2。

## Phase 2: 共通テクニック（FR-12, FR-13）

- [x] `src/lib/techniques.ts`、TechniqueList / TechniqueEdit（参照レシピ数表示）
- [x] `src/lib/techniqueMarkup.ts`（`parseInstruction`, `extractTechniqueIds`, `wrapSelection`）+ テスト
- [x] `StepText` 部品（記法をリンク風ボタンに描画。存在しない ID は語句のみ）
- [x] `TechniqueModal`（`<dialog>`、フォーカス復帰、スクロール位置維持）
- [x] RecipeEdit の手順欄に「テクニックを紐づけ」

受け入れ: §13-6, 7。

## Phase 3: 料理モードと画面消灯抑止（FR-06, FR-07）

- [x] `src/lib/wakeLock.ts`（request / release / visibilitychange で再取得 / 非対応判定）
- [x] CookMode（保存済みレシピ用と一時アレンジ用の両方）
- [x] 状態表示と終了ボタン

受け入れ: §13-3, 4, 5。

## Phase 4: AI アレンジと親子（FR-08〜FR-11）

- [x] `api/_lib/arrange/schema.ts`（zod、不正 techniqueId の除去）+ テスト
- [x] `api/_lib/arrange/prompt.ts`, `gemini.ts`, `api/arrange.ts`
- [x] `src/lib/arrangeClient.ts`, `arrangeSession.ts`
- [x] ArrangeInput / ArrangeResult（今回だけ料理・子として保存・再生成・キャンセル）
- [x] 子レシピ保存（`sourceType: "ai_arranged"`, `parentRecipeId`, `arrangementRequest`）

受け入れ: §13-8〜12。

## Phase 5: 仕上げ

- [ ] エラー処理の見直し（ネットワーク・Firestore 失敗時の表示）
- [ ] README 更新、`docs/setup.md` の手順で実機確認

## Phase 6: Markdown 取り込み（2026-09-28 ユーザー決定、docs/decisions.md）

- [x] `api/_lib/ai.ts` に `getClient` / `getModel` / `AiProviderError` / エラー正規化を切り出し、`api/_lib/arrange/gemini.ts` から再利用（既存 import パス・テストは壊さない）
- [x] `api/_lib/import/schema.ts`（リクエスト/レスポンスの zod スキーマ）+ テスト
- [x] `api/_lib/import/prompt.ts`, `api/_lib/import/gemini.ts`, `api/import-normalize.ts`
- [x] `vercel.json` に `/api/import-normalize` の関数設定を追加
- [x] `src/lib/recipeMarkdown.ts`（正規化テンプレート → `RecipeInput[]` の決定的パーサ）+ テスト
- [x] `src/lib/importClient.ts`（`/api/import-normalize` 呼び出し）
- [x] `src/pages/RecipeImport.tsx`（入力 → 整形結果編集 → 一覧プレビュー・一括登録の3段構成）、ルート `/recipes/import`
- [x] `RecipeList` に「Markdownから登録」導線を追加

受け入れ:
- 貼り付け／`.md` ファイル選択（複数可）の両方からMarkdownを入力できる
- AI整形結果を編集して「この内容で読み込み直す」でAIを呼ばずに再解析できる
- 1入力に複数レシピがあれば一覧＋チェックボックスで選択でき、選択分のみ登録される
- 材料・手順が0件等の解析エラーがあるレシピはチェックできず、理由が表示される
- `npm run build` / `npm test` / `npm run lint` が通る
