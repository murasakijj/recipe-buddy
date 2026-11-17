import { auth } from "./firebase";

export class ApiError extends Error {
  status: number;
  /** quota_exhausted / rate_limited で、再試行までの目安秒数が分かる場合のみ。 */
  retryAfterSec?: number;

  constructor(status: number, message: string, retryAfterSec?: number) {
    super(message);
    this.status = status;
    if (retryAfterSec !== undefined) {
      this.retryAfterSec = retryAfterSec;
    }
  }
}

/**
 * エラーレスポンスからコード(と、あれば retryAfterSec)を取り出す。VercelがFunction自体をロードできず
 * HTMLの500ページを返すことがあるため、JSONとしてパースできない場合は
 * それと分かるよう "server_error" にする("unknown_error" とは区別する)。
 */
export async function readErrorInfo(
  res: Response,
): Promise<{ code: string; retryAfterSec?: number }> {
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { code: "server_error" };
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as { error?: unknown }).error === "string"
  ) {
    const { error, retryAfterSec } = parsed as {
      error: string;
      retryAfterSec?: unknown;
    };
    return typeof retryAfterSec === "number" &&
      Number.isFinite(retryAfterSec) &&
      retryAfterSec >= 0
      ? { code: error, retryAfterSec }
      : { code: error };
  }
  return { code: "unknown_error" };
}

export async function readError(res: Response): Promise<string> {
  return (await readErrorInfo(res)).code;
}

/** エラーレスポンスから `ApiError`(コード+retryAfterSec)を作る。 */
export async function apiErrorFromResponse(res: Response): Promise<ApiError> {
  const { code, retryAfterSec } = await readErrorInfo(res);
  return new ApiError(res.status, code, retryAfterSec);
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
