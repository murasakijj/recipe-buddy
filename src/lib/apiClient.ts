import { auth } from "./firebase";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * エラーレスポンスからコードを取り出す。VercelがFunction自体をロードできず
 * HTMLの500ページを返すことがあるため、JSONとしてパースできない場合は
 * それと分かるよう "server_error" にする("unknown_error" とは区別する)。
 */
export async function readError(res: Response): Promise<string> {
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return "server_error";
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as { error?: unknown }).error === "string"
  ) {
    return (parsed as { error: string }).error;
  }
  return "unknown_error";
}

/** Firebase IDトークンを Authorization ヘッダとして返す。未ログインなら 401。 */
export async function authHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new ApiError(401, "not_authenticated");
  }
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

/** ログイン直後の許可判定に使う。 */
export async function checkAuth(): Promise<void> {
  const headers = await authHeader();
  const res = await fetch("/api/auth-check", { headers });
  if (!res.ok) {
    throw new ApiError(res.status, await readError(res));
  }
}
