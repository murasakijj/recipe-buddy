# データモデル（Firestore）

> 仕様 §10 の論理モデルを Firestore に落としたもの。すべて `users/{uid}` 配下に置き、他人のデータと混ざらない。

## コレクション構成

```
users/{uid}
  ├─ recipes/{recipeId}
  └─ techniques/{techniqueId}
```

`users/{uid}` ドキュメント自体は作らなくてよい（サブコレクションのみ使用）。

## Recipe（`users/{uid}/recipes/{recipeId}`）

```ts
interface Recipe {
  id: string;                     // ドキュメントID
  title: string;                  // 必須
  description: string | null;     // 概要・メモ
  servings: string | null;        // 例 "2", "1〜2食分"。自由文字列
  cookingTimeMinutes: number | null;
  parentRecipeId: string | null;  // 子レシピのとき親のID
  sourceType: "manual" | "ai_arranged";
  arrangementRequest: string | null; // 子レシピ生成時のユーザー要求
  category: string | null;
  tags: string[];
  imageUrl: string | null;        // MVPではUI非対応
  safetyNotes: string[];          // AIアレンジ保存時の安全上の注意（manual は []）
  changeSummary: string[];        // AIアレンジ保存時の主な変更点（manual は []）
  ingredients: Ingredient[];      // 配列順 = 表示順
  steps: Step[];                  // 配列順 = 手順番号
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface Ingredient {
  id: string;            // クライアント生成（crypto.randomUUID）
  name: string;          // 必須
  quantity: string | null; // "1/2", "100〜150" などをそのまま保持
  unit: string | null;
  note: string | null;   // 冷凍、薄切り など
}

interface Step {
  id: string;
  instruction: string;   // [[techniqueId|表示語句]] 記法を含んでよい
  techniqueIds: string[]; // instruction から抽出した参照ID（保存時に再計算）
}
```

### AIアレンジ由来の付加情報

`sourceType: "ai_arranged"` の子レシピは、生成結果の `safetyNotes` と `changeSummary` を保存し、詳細画面と料理モードで表示する（FR-09 の「食品安全上のリスクを明示」を保存後も維持するため）。`questions` と `newTechniqueCandidates` は保存しない。編集画面ではこれらは表示のみで編集対象にしない。

### 必須入力（FR-04）

- `title` が空でない
- `ingredients` が1件以上で、各 `name` が空でない
- `steps` が1件以上で、各 `instruction` が空でない

### 親子関係（FR-11 / decisions.md）

- 1階層のみ。`parentRecipeId` を持つレシピの `parentRecipeId` を持つレシピは作らない。
- 子レシピからアレンジして保存する場合、新しい子の `parentRecipeId` は元の子の `parentRecipeId`（ルート）にする。
- 親を削除するときは、`parentRecipeId == 親ID` の子をすべて `parentRecipeId = null` に更新してから削除する（バッチ書き込み）。

## Technique（`users/{uid}/techniques/{techniqueId}`）

```ts
interface Technique {
  id: string;
  name: string;              // 必須
  summary: string | null;    // 短い説明
  instructions: string[];    // 必須。1要素 = 1手順
  cautions: string | null;
  media: null;               // 将来用。MVPでは常に null
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 参照元の確認（SC-08）

テクニック管理画面の「参照中レシピ数」は、読み込んだレシピ一覧を `steps[].techniqueIds` で走査して数える（クエリではなくクライアント集計。件数は数百件想定で十分）。

### 削除時

テクニックを削除しても、参照しているレシピの本文はそのまま残す。表示時に存在しないIDの `[[id|語句]]` は語句のプレーンテキストとして描画する。

## テクニック参照記法（FR-13）

手順本文 `instruction` の中に以下の形式で埋め込む。

```
人参を[[tq_abc123|細切り]]にする。
```

- `techniqueId` はドキュメントID。URL は埋め込まない。
- 表示時に `techniqueMarkup.ts` の `parseInstruction(text)` でセグメントに分解し、テクニックが存在すればリンク風ボタン、なければプレーンテキストとして描画する。
- 編集画面では、手順テキストエリアで語句を選択して「テクニックを紐づけ」を押すと、選択範囲を `[[id|語句]]` に置き換える。テキストエリア内では記法がそのまま見える（MVPではこれを許容）。
- 保存時に `techniqueIds` を本文から抽出して更新する。

## 一時アレンジ（§10.7）

保存前のアレンジ結果は Firestore に置かない。`sessionStorage` に `arrange:{parentRecipeId}` キーで以下を保持する。

```ts
interface ArrangeSession {
  parentRecipeId: string;
  request: string;              // ユーザー入力（失敗時も保持）
  result: ArrangedRecipe | null;
  createdAt: string;            // ISO
}
```

`ArrangedRecipe` の形は [api.md](./api.md) を参照。

## Firestore セキュリティルール

[firebase/firestore.rules](../firebase/firestore.rules) を Firebase Console に貼る。要点:

```
match /users/{userId}/{document=**} {
  allow read, write: if request.auth != null
    && request.auth.uid == userId
    && request.auth.token.email in ALLOWED_EMAILS;
}
```

`ALLOWED_EMAILS` はルール内のリテラル配列。コンソールで実際のメールに置き換える。

## インデックス

- 一覧は `users/{uid}/recipes` を `orderBy("updatedAt", "desc")` で取得する。単一フィールドなので複合インデックス不要。
- 検索・絞り込みはクライアント側で行う（件数が小さいため）。
