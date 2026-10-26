import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// firebase-admin をモックする。getApps が初期化済みアプリを返すことで、
// getFirebaseApp が FIREBASE_SERVICE_ACCOUNT env を要求せず既存アプリを使う。
const { verifyIdToken, getApps, initializeApp, cert } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getApps: vi.fn(),
  initializeApp: vi.fn(),
  cert: vi.fn(),
}));

vi.mock("firebase-admin/app", () => ({ getApps, initializeApp, cert }));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken }),
}));

// モック定義後に import する。
const { requireAuth } = await import("./auth.js");

describe("requireAuth", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
    getApps.mockReset();
    getApps.mockReturnValue([{}]);
    process.env.ALLOWED_EMAILS = "ok@example.com, two@example.com";
  });

  it("Authorization ヘッダが無ければ 401", async () => {
    await expect(requireAuth(undefined)).rejects.toMatchObject({
      statusCode: 401,
      message: "missing_token",
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("Bearer 形式でなければ 401", async () => {
    await expect(requireAuth("Basic abc123")).rejects.toMatchObject({
      statusCode: 401,
      message: "missing_token",
    });
  });

  it("トークンが空文字なら 401", async () => {
    await expect(requireAuth("Bearer   ")).rejects.toMatchObject({
      statusCode: 401,
      message: "missing_token",
    });
  });

  it("トークン検証に失敗したら 401", async () => {
    verifyIdToken.mockRejectedValue(new Error("bad token"));
    await expect(requireAuth("Bearer sometoken")).rejects.toMatchObject({
      statusCode: 401,
      message: "invalid_token",
    });
  });

  it("許可リスト外のメールなら 403", async () => {
    verifyIdToken.mockResolvedValue({
      uid: "u1",
      email: "stranger@example.com",
    });
    await expect(requireAuth("Bearer sometoken")).rejects.toMatchObject({
      statusCode: 403,
      message: "forbidden",
    });
  });

  it("メールが無いトークンなら 403", async () => {
    verifyIdToken.mockResolvedValue({ uid: "u1" });
    await expect(requireAuth("Bearer sometoken")).rejects.toMatchObject({
      statusCode: 403,
      message: "forbidden",
    });
  });

  it("許可リスト内のメール(大文字小文字・前後空白を無視)なら通す", async () => {
    verifyIdToken.mockResolvedValue({ uid: "u1", email: "OK@Example.com" });
    await expect(requireAuth("Bearer sometoken")).resolves.toEqual({
      uid: "u1",
      email: "ok@example.com",
    });
  });

  it("配列で渡された Authorization ヘッダも先頭要素で判定する", async () => {
    verifyIdToken.mockResolvedValue({ uid: "u2", email: "two@example.com" });
    await expect(
      requireAuth(["Bearer sometoken", "Bearer other"]),
    ).resolves.toEqual({ uid: "u2", email: "two@example.com" });
  });

  it("ALLOWED_EMAILS が未設定なら全員 403", async () => {
    delete process.env.ALLOWED_EMAILS;
    verifyIdToken.mockResolvedValue({ uid: "u1", email: "ok@example.com" });
    await expect(requireAuth("Bearer sometoken")).rejects.toMatchObject({
      statusCode: 403,
      message: "forbidden",
    });
  });
});

// getFirebaseApp は初期化結果をモジュール内にキャッシュするため、
// 初期化経路のテストでは毎回モジュールを読み直す。
describe("requireAuth: firebase-admin の初期化", () => {
  const saved = { ...process.env };

  async function loadFresh() {
    vi.resetModules();
    return await import("./auth.js");
  }

  beforeEach(() => {
    verifyIdToken.mockReset();
    getApps.mockReset();
    getApps.mockReturnValue([]);
    initializeApp.mockReset();
    initializeApp.mockReturnValue({});
    cert.mockReset();
    cert.mockImplementation((v: unknown) => v);
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    delete process.env.FIREBASE_PROJECT_ID;
    process.env.ALLOWED_EMAILS = "ok@example.com";
    verifyIdToken.mockResolvedValue({ uid: "u1", email: "ok@example.com" });
  });

  afterAll(() => {
    process.env = saved;
  });

  it("FIREBASE_PROJECT_ID だけなら projectId で初期化し、資格情報は渡さない", async () => {
    process.env.FIREBASE_PROJECT_ID = "shared-project";
    const { requireAuth: fresh } = await loadFresh();
    await expect(fresh("Bearer sometoken")).resolves.toEqual({
      uid: "u1",
      email: "ok@example.com",
    });
    expect(initializeApp).toHaveBeenCalledWith({ projectId: "shared-project" });
    expect(cert).not.toHaveBeenCalled();
  });

  it("FIREBASE_SERVICE_ACCOUNT があれば従来どおり cert で初期化する(PROJECT_ID より優先)", async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: "legacy",
    });
    process.env.FIREBASE_PROJECT_ID = "shared-project";
    const { requireAuth: fresh } = await loadFresh();
    await fresh("Bearer sometoken");
    expect(cert).toHaveBeenCalledWith({ project_id: "legacy" });
    expect(initializeApp).toHaveBeenCalledWith({
      credential: { project_id: "legacy" },
    });
  });

  it("どちらも無ければ設定エラー(AuthError ではない)で、401 にならない", async () => {
    const { requireAuth: fresh, AuthError } = await loadFresh();
    const err = await fresh("Bearer sometoken").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AuthError);
    expect((err as Error).message).toContain("FIREBASE_PROJECT_ID");
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});
