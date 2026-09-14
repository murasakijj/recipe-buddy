# recipe-buddy — Claude Code ガイド

## プロジェクト概要

自分のレシピを蓄積し、その日の材料・状況に合わせて AI が「今日作れるレシピ」へアレンジし、スマホで料理を支援する個人用 Web アプリ。仕様は `spec/recipe_app_mvp_spec_v0.1.md`。

## 実装の進め方（重要）

**[docs/implementation-plan.md](../docs/implementation-plan.md) のフェーズを上から順に進める。** 設計は以下が正。設計とズレる実装をしたくなったら、勝手に変えずユーザーに確認し、docs を直してからコードを書く。

| 文書 | 内容 |
| --- | --- |
| [docs/decisions.md](../docs/decisions.md) | 仕様書の未決事項の決定（親子1階層、親削除で子独立化、`[[id|語句]]` 記法 など） |
| [docs/architecture.md](../docs/architecture.md) | 構成・認証・環境変数・セキュリティ |
| [docs/data-model.md](../docs/data-model.md) | Firestore スキーマ |
| [docs/api.md](../docs/api.md) | Vercel Functions（`/api/arrange`）と AI プロンプト |
| [docs/ui.md](../docs/ui.md) | ルートと画面仕様 |
| [docs/setup.md](../docs/setup.md) | Firebase / Vercel の手動設定 |

仕様 §15 の追加候補（Markdown インポート、人数換算、調理記録）と §5.2 の対象外機能は**実装しない**。

## 技術スタック（確定）

- React 19 + Vite + TypeScript、react-router-dom、素の CSS（モバイルファースト）
- Firebase Authentication（Google）+ Cloud Firestore（`users/{uid}/recipes`, `users/{uid}/techniques`）
- Vercel（静的配信 + Functions `api/`）。`/api/arrange` が Gemini `gemini-2.5-flash` を呼ぶ
- zod（AI 出力・API ボディ検証）、vitest

## 絶対に守るセキュリティルール

1. `GEMINI_API_KEY` / `FIREBASE_SERVICE_ACCOUNT` をフロントに出さない（`VITE_` を付けない）
2. すべての `/api/*` は `requireAuth`（ID トークン検証 + `ALLOWED_EMAILS`）を通す
3. AI 出力は zod で検証し、存在しない techniqueId を除去してから返す
4. `dangerouslySetInnerHTML` を使わない

## 参考: 既存資産

- 認証の実績実装: `C:\workspace\money-lens`（`api/_lib/auth.ts`, `src/contexts/AuthContext.tsx`, `src/pages/Login.tsx` をほぼそのまま移植してよい）
- Firestore + Google ログインの実績: `C:\workspace\walk_diary\index.html`
- サンプルレシピ（手動登録の参考）: `recipe/*.md`

## コマンド

```
npm run dev     # フロント開発サーバー（/api は動かない）
npm run build   # tsc -b && vite build
npm test        # vitest run
npm run lint
```
