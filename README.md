# recipe-buddy

自分のレシピを蓄積し、その日の材料や状況に合わせて AI が「今日作れるレシピ」へアレンジし、
スマートフォンで料理そのものを支援する個人用 Web アプリ。React 19 + Vite + TypeScript の
SPA と、Firebase（Authentication + Firestore）、Vercel Functions 経由の Gemini API で構成する。

## ドキュメント

- [spec/recipe_app_mvp_spec_v0.1.md](./spec/recipe_app_mvp_spec_v0.1.md) — プロダクト仕様(MVP)
- [docs/decisions.md](./docs/decisions.md) — 仕様書の未決事項の決定
- [docs/architecture.md](./docs/architecture.md) — 構成・認証・環境変数・セキュリティ
- [docs/data-model.md](./docs/data-model.md) — Firestore スキーマ
- [docs/api.md](./docs/api.md) — Vercel Functions（`/api/arrange` など）と AI プロンプト
- [docs/ui.md](./docs/ui.md) — ルートと画面仕様
- [docs/setup.md](./docs/setup.md) — Firebase / Vercel の手動セットアップ手順
- [docs/implementation-plan.md](./docs/implementation-plan.md) — 実装フェーズの進捗

## コマンド

```
npm install
npm run dev        # フロント開発サーバー(/api は動かない。docs/setup.md §4 参照)
npm run build      # tsc -b && vite build
npm run preview    # ビルド結果のプレビュー
npm test           # vitest run
npm run test:watch
npm run lint
npm run format      # prettier --write
```

`/api/*`（認証チェック・AI アレンジ）込みでローカル動作確認する場合は `vercel dev` を使う
（詳細は [docs/setup.md](./docs/setup.md)）。
