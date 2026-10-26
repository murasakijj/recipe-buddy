# firebase/

**Firestore のセキュリティルール・インデックスの正本は household-chore-manager リポジトリの `firebase/` にある。このリポジトリからはデプロイしない。**

Firebase は household-chore-manager・money-lens・recipe-buddy・fridge-track の4アプリで1つのプロジェクト（共有プロジェクト）を使っている。1つのプロジェクトに適用できるルールは1つだけなので、このリポジトリから単独のルールをデプロイすると、他アプリのルールが消えて動かなくなる（またはルールが緩むおそれがある）。ルール・インデックスを変えたいときは household-chore-manager の `firebase/` を編集してそちらからデプロイすること。

経緯と切り替え手順は household-chore-manager の `docs/firebase-consolidation.md` を参照。

## このアプリが使うコレクション

クライアント（Firebase SDK）から直接読み書きする。すべて本人の uid 配下のみ。

| パス | 内容 |
| --- | --- |
| `users/{uid}/recipes/{recipeId}` | レシピ |
| `users/{uid}/techniques/{techniqueId}` | テクニック |

新しいコレクションを使うようにしたときは、household-chore-manager 側の統合ルールにこのアプリ用のマッチを追加し、この表も更新する。`users/{uid}/` 配下全体を許可するワイルドカードは使わない（fridge-track のコレクションの制約を破ってしまう）。
