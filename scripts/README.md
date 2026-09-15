# scripts/

`recipe/*.md`（手書きのレシピ記録）を Firestore へ一回限り移行するための
ローカルスクリプト。アプリ本体（`src/`, `api/`）には含まれず、Vercel の
ビルド・デプロイ対象でもない。

- `seed/recipes.json`: 3つの Markdown ファイルから手動で書き起こした
  レシピ13件（`RecipeInput` 相当、id/timestamps 無し）。
- `seed/recipes.test.ts`: 上記が `src/lib/recipeValidation.ts` の必須項目
  チェックを通ることを確認する vitest テスト（`npm test` に含まれる）。
- `import-recipes.mjs`: `recipes.json` を Firestore
  `users/{uid}/recipes/import-{importKey}` へ書き込む。

前提: Firebase サービスアカウントJSON（`--service-account` か環境変数
`FIREBASE_SERVICE_ACCOUNT`）と、移行先ユーザーのメールアドレス。

```
node scripts/import-recipes.mjs --email you@gmail.com \
  [--service-account parameters/firebase-service-account.json] \
  [--dry-run] [--yes] [--force]
```

ドキュメントIDは `import-<importKey>` 固定。書き込み前に対象ユーザーの
`uid` と実行計画（作成/スキップ/上書き）を表示し、`--yes` を付けない限り
実際には書き込まない。既存のドキュメントはデフォルトでスキップするため、
**アプリ側で編集したレシピは `--force` を付けない限り上書きされない**。
13件を1つの Firestore バッチにまとめて書き込むため、失敗しても一部だけ
書き込まれた状態にはならない。`--dry-run` は Firestore に一切アクセスせず
（サービスアカウントの読み込みだけ行う）、対象レシピの一覧だけ表示する。
