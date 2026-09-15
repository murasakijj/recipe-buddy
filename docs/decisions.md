# 未決事項の決定記録（spec §14 / §17 対応）

> 決定日: 2026-09-14。仕様書 `spec/recipe_app_mvp_spec_v0.1.md` §14 の未決事項と §17 の「実装着手時に確定する事項」をここで確定する。実装はこの決定に従う。変更したい場合はまずこの文書を直す。

## §17 実装着手時に確定する事項

| # | 項目 | 決定 |
| --- | --- | --- |
| 1 | 技術スタック | React 19 + Vite + TypeScript / react-router-dom / Firebase (Auth + Firestore) / Vercel (静的配信 + Functions) / Gemini API。詳細は [architecture.md](./architecture.md) |
| 2 | 認証・公開範囲 | インターネット公開（Vercel）。Googleログイン必須。`ALLOWED_EMAILS` に含まれるメールのみ利用可。本人1名利用 |
| 3 | データベース | Cloud Firestore。ユーザーごとのサブコレクション（`users/{uid}/...`）。詳細は [data-model.md](./data-model.md) |
| 4 | AIサービスとAPIキー管理 | Gemini `gemini-3.6-flash`（無料枠）。APIキーは Vercel 環境変数 `GEMINI_API_KEY` のみに置き、`/api/arrange` 経由で呼ぶ。ブラウザには出さない。**2026-09-15: gemini-2.5-flash が新規ユーザー向けに提供終了したため gemini-3.6-flash に変更** |
| 5 | MVP追加候補（§15）の採否 | **すべて不採用**（Markdownインポート／人数換算／調理記録は実装しない） |
| 6 | 利用端末・対象ブラウザ | iPhone Safari（iOS 16.4+）と Android Chrome を主対象。PCは Chrome/Edge 最新で閲覧・編集できればよい |

## §14 優先度A

| 未決事項 | 決定 | 理由 |
| --- | --- | --- |
| 利用者と認証 | 本人のみ。ログイン必須（Google） | 仕様 §4.1「主利用者1名」。walk_diary / money-lens と同じ運用 |
| 配置・公開範囲 | Vercel でインターネット公開（URLは非公開扱い） | AIキー秘匿に Functions が必要。GitHub Pages では不可 |
| AIサービス | Gemini 2.5 Flash、JSON構造化出力（`responseSchema`） | Google機能で統一、無料枠、money-lensで実績 |
| AI確認フロー | **注意付きで生成し、確認事項を `questions` として併記**。生成をブロックしない | 料理中の往復を減らす。安全リスクは `safetyNotes` で明示 |
| 親子階層 | **1階層のみ**。子レシピからアレンジした場合、保存時の親は元の親（ルート）にする | 表示・削除の扱いが単純になる |
| 親削除時の子 | **子を独立化**（`parentRecipeId = null` に更新）。削除確認ダイアログで子の件数を表示 | データを失わない。仕様 FR-05「影響を表示」を満たす |
| Technique本文内位置 | **独自記法**: 手順本文に `[[<techniqueId>|<表示語句>]]` を埋め込む。URLは埋め込まない | 編集で位置がずれない。表示時にIDで最新のテクニックを引くので更新が反映される（FR-13） |

## §14 優先度B

| 未決事項 | 決定 |
| --- | --- |
| カテゴリ・タグ | 両方持つ。カテゴリは単一文字列（任意）、タグは文字列配列（任意、カンマ区切り入力）。マスタは作らない |
| 画像 | MVPでは**UI非対応**。データに `imageUrl: string \| null` だけ持たせる |
| 一時アレンジの保持期間 | セッション中のみ。`sessionStorage` に保持し、タブを閉じたら消える。保存／キャンセルで破棄 |
| データのバックアップ | MVPでは実装しない。Firestore コンソールのエクスポートで代替 |
| 対応ブラウザ | 上記 §17-6 のとおり |
| レシピ名の重複 | 許可する（警告なし） |

## その他の実装判断

- 材料・手順はレシピドキュメント内の配列として保持する（別コレクションにしない）。並び順は配列の順序で表現する。
- テクニックの `instructions` は文字列配列（1要素＝1手順）。
- Firebase Storage は使わない。
- AIアレンジを子レシピとして保存するとき、`safetyNotes` と `changeSummary` もレシピに保存する（2026-09-14 レビュー指摘で追加。data-model.md 参照）。
- 状態管理は React Context + hooks のみ。UIライブラリは使わず、モバイルファーストの素のCSSで作る。
