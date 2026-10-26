# セットアップ手順（手動作業）

コード以外に、以下をユーザーがコンソールで設定する必要がある。

## 1. Firebase プロジェクト

このアプリは専用の Firebase プロジェクトを作らず、household-chore-manager と同じ**共有プロジェクト**を使う（無料枠のプロジェクト数上限を避けるため）。共有プロジェクトの Authentication・Firestore・ルール・インデックスは household-chore-manager 側で用意・管理する。旧プロジェクトからの切り替え手順（データ移行を含む）は household-chore-manager の `docs/firebase-consolidation.md` を参照。

1. **承認済みドメイン**: 共有プロジェクトの Authentication → Settings → 承認済みドメインに Vercel 本番ドメインを追加（共有プロジェクト側に登録する）。ドメインは Vercel ダッシュボードのプロジェクト画面「Domains」に表示される `xxxx.vercel.app`（`recipe-buddy.vercel.app` は他人のプロジェクトなので使わない）。
2. **`VITE_FIREBASE_*`**: 共有プロジェクトの プロジェクトの設定 → 全般 → マイアプリ にある既存の Web アプリ設定（`firebaseConfig`）を使う。このアプリ用に Web アプリを追加登録する必要はない。
3. **サーバー側**: Vercel の `FIREBASE_PROJECT_ID` に共有プロジェクトの ID を設定する（推奨）。このアプリのサーバーは ID トークンの検証しかしないので、**サービスアカウントは渡さない**（渡すと他アプリのデータを読み書きできる権限を持ってしまうため）。`FIREBASE_SERVICE_ACCOUNT` を設定した場合は従来どおりそちらが優先される（後方互換。共有プロジェクトでは設定しない）。
4. **Firestore ルール・インデックス**: このリポジトリからはデプロイしない。正本は household-chore-manager の `firebase/`（[firebase/README.md](../firebase/README.md) 参照）。

## 2. Gemini API キー

https://aistudio.google.com/apikey で取得（`GEMINI_API_KEY`）。

## 3. Vercel

1. https://vercel.com/ で GitHub リポジトリ `murasakijj/recipe-buddy` をインポート（Framework: Vite）。
2. Settings → Environment Variables に以下を登録:
   - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
   - `FIREBASE_PROJECT_ID`（共有プロジェクトの ID。`FIREBASE_SERVICE_ACCOUNT` は設定しない）
   - `ALLOWED_EMAILS`（自分の Gmail）
   - `GEMINI_API_KEY`
3. Deploy。以降 `main` への push で自動デプロイ。

## 4. ローカル開発

```
cp .env.example .env.local   # VITE_FIREBASE_* を埋める
npm install
npm run dev                  # フロントのみ（/api は動かない）
```

`/api/*` をローカルで動かす場合は `npm i -g vercel` → `vercel link` → `vercel env pull` → `vercel dev`。

> **注意**: 単純な `npm run dev` では `/api/*` が動かないため、ログイン後に呼ばれる
> `GET /api/auth-check` が失敗し、ログイン画面に「認証サーバーに接続できませんでした。」が
> 表示され続ける（ログインは完了しているのに先へ進めない）。認証込みの動作を確認したい場合は
> 必ず `vercel dev` を使うこと。

## 5. 動作確認（MVP受入条件 §13）

- スマホでログイン → レシピ登録 → 詳細 → 料理モードで画面が消えないこと（iOS Safari 16.4+ / Android Chrome）
- テクニックリンク → モーダル → 閉じてスクロール位置が保たれること
- アレンジ生成 → 今回だけ料理 / 子として保存 → 親子を相互にたどれること

## 6. トラブル時の確認場所

- **Vercel Functions のエラー**: Vercel → プロジェクト → 上部タブ「Logs」→ `/api/...` の赤い行（500）をクリックすると、`Error:` で始まる実際のエラー文とスタックが見える。「認証サーバーに接続できませんでした」が出るときはまずここを見る。
- **ビルド失敗**: Vercel → 「Deployments」→ 該当デプロイ → 「Building」のログ。
- **Firestore の拒否**: ブラウザの開発者ツール Console に `permission-denied` が出る。household-chore-manager 側の統合ルールがデプロイ済みか、許可メールが正しいかを確認する。
- **既知の落とし穴**: `firebase-admin` が使う `jwks-rsa` は ESM 専用の `jose` v6 を `require()` するため、Vercel のランタイムで `ERR_REQUIRE_ESM` になる。`package.json` の `overrides` で `jose` を v4 に固定している。依存を更新するときはこの行を消さないこと。
