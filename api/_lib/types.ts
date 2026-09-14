import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Vercelの Node.js Functions ランタイムが実際に req/res に付与する
 * ヘルパー(query/body の自動パース、status/json)のみを型付けする最小限の定義。
 * @vercel/node パッケージは推移的な脆弱依存(devのみ)を持ち込むため使用しない。
 */
export interface ApiRequest extends IncomingMessage {
  query: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface ApiResponse extends ServerResponse {
  status(statusCode: number): ApiResponse;
  json(body: unknown): void;
  send(body: string): void;
}

export type ApiHandler = (
  req: ApiRequest,
  res: ApiResponse,
) => Promise<void> | void;
