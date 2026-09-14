# セットアップ手順（手動作業）

コード以外に、以下をユーザーがコンソールで設定する必要がある。

## 1. Firebase プロジェクト

1. https://console.firebase.google.com/ で新規プロジェクト（例: `recipe-buddy`）を作成。
2. **Authentication** → Sign-in method → **Google** を有効化（サポートメール設定）。
3. **Authentication** → Settings → 承認済みドメインに Vercel 本番ドメインを追加。ドメインは Vercel ダッシュボードのプロジェクト画面「Domains」に表示される `xxxx.vercel.app`（`recipe-buddy.vercel.app` は他人のプロジェクトなので使わない）。
4. **Firestore Database** を作成（ロケーション `asia-northeast1`、本番モード）。
5. Firestore → ルール に [firebase/firestore.rules](../firebase/firestore.rules) を貼り、`ALLOWED_EMAILS` の中身を自分のメールに置き換えて公開。
6. プロジェクトの設定 → 全般 → マイアプリ → Web アプリを追加 → `firebaseConfig` を取得（`VITE_FIREBASE_*` に使う）。
7. プロジェクトの設定 → サービスアカウント → 「新しい秘密鍵の生成」で JSON を取得（`FIREBASE_SERVICE_ACCOUNT` に使う。1行に潰す）。

## 2. Gemini API キー

https://aistudio.google.com/apikey で取得（`GEMINI_API_KEY`）。

## 3. Vercel

1. https://vercel.com/ で GitHub リポジトリ `murasakijj/recipe-buddy` をインポート（Framework: Vite）。
2. Settings → Environment Variables に以下を登録:
   - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
   - `FIREBASE_SERVICE_ACCOUNT`（JSON 1行）
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
