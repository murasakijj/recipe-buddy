# recipe-buddy アーキテクチャ

> 対象読者: 実装を担当するAIモデル / 開発者。仕様は `spec/recipe_app_mvp_spec_v0.1.md`、未決事項の決定は [decisions.md](./decisions.md)。

## システム構成

```
ユーザー（スマホ / PC ブラウザ）
  │
  │ ① Googleログイン（Firebase Authentication）
  │ ② レシピ・テクニックの読み書き（Firestore SDK 直接。セキュリティルールで本人限定）
  │ ③ AIアレンジ（Authorization: Bearer <idToken> で /api/arrange）
  ▼
┌──────────────────────────────┐    ┌──────────────────────┐
│ Vercel                        │    │ Firebase              │
│  ├─ 静的配信: React + Vite SPA │    │  ├─ Authentication    │
│  └─ Functions (/api/*)         │    │  └─ Firestore         │
│      ├─ /api/auth-check       │    │     users/{uid}/...   │
│      └─ /api/arrange ─────────┼──▶ Gemini API (gemini-3.6-flash)
└──────────────────────────────┘    └──────────────────────┘
```

## 設計原則

1. **秘密情報はブラウザに置かない**。`GEMINI_API_KEY` と `FIREBASE_SERVICE_ACCOUNT` は Vercel 環境変数のみ。`VITE_` プレフィックスを付けない。
2. **すべての `/api/*` は `requireAuth`（IDトークン検証 + `ALLOWED_EMAILS` 照合）を通す**。例外なし。
3. **Firestore はセキュリティルールで守る**。`users/{uid}` 配下は `request.auth.uid == uid` かつ許可メールのみ読み書き可。
4. **元レシピを AI が上書きしない**。アレンジ結果は別ドキュメント（子レシピ）として保存するか、セッション内で一時利用するだけ。
5. 仕様外の機能を追加しない。§15 の追加候補は不採用（[decisions.md](./decisions.md)）。

## 技術スタック

| 領域 | 技術 | 備考 |
| --- | --- | --- |
| フロント | React 19 + Vite + TypeScript | SPA。money-lens と同じ構成 |
| ルーティング | react-router-dom v7 | |
| 認証 | Firebase Authentication（Google） | `signInWithPopup` |
| データ | Cloud Firestore（firebase v12 modular SDK） | Storage は使わない |
| ホスティング | Vercel（Hobby） | GitHub push で自動デプロイ |
| API | Vercel Functions（`api/` ディレクトリ、Node.js） | 型は `api/_lib/types.ts` の最小定義（`@vercel/node` は使わない） |
| トークン検証 | firebase-admin | `verifyIdToken` |
| AI | `@google/genai` + `gemini-3.6-flash` | JSON構造化出力 |
| スキーマ検証 | zod | AI出力とAPIボディの検証 |
| テスト | vitest | ロジック（マーカー解析、AI出力検証、認証）に単体テスト |

## 認証・認可の流れ

1. `Login` 画面で `signInWithPopup(auth, GoogleAuthProvider)`。
2. `onAuthStateChanged` でユーザー取得後、`GET /api/auth-check` を Bearer トークン付きで呼び、403 なら `signOut` して「アクセス権がありません」を表示（money-lens の `AuthContext` と同じ）。
3. 認可済みユーザーのみ `RequireAuth` 配下の画面を表示。
4. Firestore への読み書きは SDK 直接。ルールで `uid` と許可メールを二重に確認する（[firebase/firestore.rules](../firebase/firestore.rules)）。
5. `/api/arrange` は `requireAuth` 通過後に Gemini を呼ぶ。

## 環境変数

Vercel（サーバー側、秘密）:

| 変数 | 用途 |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | firebase-admin 初期化用サービスアカウント JSON（1行化） |
| `ALLOWED_EMAILS` | ログイン許可メール（カンマ区切り、小文字比較） |
| `GEMINI_API_KEY` | Gemini API キー |
| `GEMINI_MODEL` | 任意。既定 `gemini-3.6-flash` |

フロント（`VITE_` プレフィックス、公開値）:

| 変数 | 用途 |
| --- | --- |
| `VITE_FIREBASE_API_KEY` / `VITE_FIREBASE_AUTH_DOMAIN` / `VITE_FIREBASE_PROJECT_ID` / `VITE_FIREBASE_STORAGE_BUCKET` / `VITE_FIREBASE_MESSAGING_SENDER_ID` / `VITE_FIREBASE_APP_ID` | Firebase 初期化（公開設定値） |

`.env.example` に一覧を置き、`.env.local` は git 管理外。

## ディレクトリ構成

```
recipe-buddy/
├─ api/
│   ├─ _lib/
│   │   ├─ types.ts        ← ApiRequest/ApiResponse 最小型
│   │   ├─ auth.ts         ← requireAuth（money-lens から移植）
│   │   ├─ arrange/
│   │   │   ├─ schema.ts   ← AI出力の zod スキーマ・正規化
│   │   │   ├─ prompt.ts   ← システムプロンプト・入力整形
│   │   │   └─ gemini.ts   ← Gemini 呼び出し（responseSchema）
│   ├─ auth-check.ts       ← GET /api/auth-check
│   └─ arrange.ts          ← POST /api/arrange
├─ src/
│   ├─ main.tsx / App.tsx / index.css
│   ├─ lib/
│   │   ├─ firebase.ts     ← app/auth/db 初期化
│   │   ├─ types.ts        ← Recipe / Technique 等の型
│   │   ├─ recipes.ts      ← Firestore CRUD（recipes）
│   │   ├─ techniques.ts   ← Firestore CRUD（techniques）
│   │   ├─ techniqueMarkup.ts ← [[id|語句]] 記法の解析・生成
│   │   ├─ arrangeClient.ts   ← /api/arrange 呼び出し
│   │   ├─ arrangeSession.ts  ← 一時アレンジの sessionStorage 保持
│   │   └─ wakeLock.ts     ← Screen Wake Lock
│   ├─ contexts/           ← AuthContext（money-lens から移植）
│   ├─ components/         ← RequireAuth, TechniqueModal, StepText, IngredientList など
│   └─ pages/              ← 画面（[ui.md](./ui.md)）
├─ firebase/firestore.rules
├─ docs/
├─ spec/
├─ vercel.json
└─ .env.example
```

## セキュリティチェックリスト

- [ ] `GEMINI_API_KEY` / `FIREBASE_SERVICE_ACCOUNT` がフロントバンドルに含まれない
- [ ] すべての `/api/*` が `requireAuth` を通る
- [ ] `ALLOWED_EMAILS` 照合は小文字化
- [ ] Firestore ルールが `users/{uid}` を本人＋許可メールに限定している
- [ ] AI出力は zod で検証し、存在しない `techniqueId` を落としてから返す
- [ ] レシピ本文は React のテキストとして描画し、`dangerouslySetInnerHTML` を使わない
- [ ] Firebase Auth の承認済みドメインに Vercel 本番 URL を登録

## 関連ドキュメント

- [decisions.md](./decisions.md) — 未決事項の決定
- [data-model.md](./data-model.md) — Firestore スキーマ
- [api.md](./api.md) — Functions 仕様・AIプロンプト
- [ui.md](./ui.md) — 画面仕様
- [implementation-plan.md](./implementation-plan.md) — 実装タスク
- [setup.md](./setup.md) — Firebase / Vercel の手動セットアップ手順
