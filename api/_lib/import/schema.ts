import { z } from "zod";

/**
 * POST /api/import-normalize のリクエスト/レスポンスのzodスキーマ(docs/api.md)。
 */

/** 入力Markdownの文字数上限。長すぎる入力はAIの出力が途中で切れるリスクがあるため
 * サーバー側でも上限を設ける(フロントは複数ファイルを1件ずつ送ることで回避する)。 */
const MAX_MARKDOWN_LENGTH = 30_000;

export const importNormalizeRequestSchema = z.object({
  markdown: z.string().min(1).max(MAX_MARKDOWN_LENGTH),
  // ファイル選択時のファイル名。本文に日付が無い場合のタグ用日付フォールバックに
  // 使う(docs/decisions.md「Markdownインポート」)。貼り付けテキストのときは省略する。
  sourceName: z.string().max(200).optional(),
});

export type ImportNormalizeRequestBody = z.infer<
  typeof importNormalizeRequestSchema
>;

// 空文字はAIが実質的に何も返さなかったケースであり、"整形は成功したが
// 中身が空" という状態を許容するとフロントの2段目に空テンプレートが
// 正常系として渡ってしまう。呼び出し側(api/import-normalize.ts)で
// 502 invalid_ai_output として扱えるよう、ここで弾く。
export const importNormalizeResponseSchema = z.object({
  markdown: z.string().min(1),
});

export type ImportNormalizeResponse = z.infer<
  typeof importNormalizeResponseSchema
>;
