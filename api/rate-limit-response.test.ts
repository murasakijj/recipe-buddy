import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiRequest, ApiResponse } from "./_lib/types.js";
import { AiProviderError } from "./_lib/ai.js";

vi.mock("./_lib/auth.js", () => ({
  requireAuth: vi.fn(async () => ({})),
  AuthError: class AuthError extends Error {
    statusCode = 401;
  },
}));

const generate = vi.hoisted(() => vi.fn());
vi.mock("./_lib/arrange/gemini.js", () => ({
  generateArrangement: generate,
}));
vi.mock("./_lib/import/gemini.js", () => ({
  generateNormalizedMarkdown: generate,
}));
vi.mock("./_lib/import/classify-gemini.js", () => ({
  generateClassification: generate,
}));

import arrange from "./arrange.js";
import importNormalize from "./import-normalize.js";
import importClassify from "./import-classify.js";

const recipe = {
  title: "t",
  description: null,
  servings: null,
  cookingTimeMinutes: null,
  ingredients: [{ name: "a", quantity: null, unit: null, note: null }],
  steps: [{ instruction: "s" }],
};

/** AI呼び出しを、指定したエラーで失敗させる。 */
function failWith(err: Error): void {
  generate.mockImplementation(async () => {
    throw err;
  });
}

const cases: [
  string,
  (req: ApiRequest, res: ApiResponse) => Promise<void>,
  unknown,
][] = [
  ["arrange", arrange, { recipe, techniques: [], request: "r" }],
  ["import-normalize", importNormalize, { markdown: "# x" }],
  [
    "import-classify",
    importClassify,
    { recipes: [{ title: "t", ingredients: ["a"], steps: ["s"] }] },
  ],
];

async function call(
  handler: (req: ApiRequest, res: ApiResponse) => Promise<void>,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const req = {
    method: "POST",
    headers: { authorization: "Bearer x" },
    body,
  } as unknown as ApiRequest;
  const out = { status: 0, text: "" };
  const res = {
    headersSent: false,
    writableEnded: false,
    statusCode: 0,
    setHeader() {},
    end(t: string) {
      out.status = res.statusCode;
      out.text = t;
      res.writableEnded = true;
    },
  };
  await handler(req, res as unknown as ApiResponse);
  return { status: out.status, json: JSON.parse(out.text) };
}

describe.each(cases)("%s: AIの429応答", (_name, handler, body) => {
  beforeEach(() => {
    generate.mockReset();
  });

  it("quota_exhausted は HTTP 429 で retryAfterSec を返す", async () => {
    failWith(new AiProviderError(429, "quota_exhausted", 30367));
    expect(await call(handler, body)).toEqual({
      status: 429,
      json: { error: "quota_exhausted", retryAfterSec: 30367 },
    });
  });

  it("rate_limited は retryAfterSec が無ければ省く", async () => {
    failWith(new AiProviderError(429, "rate_limited"));
    expect(await call(handler, body)).toEqual({
      status: 429,
      json: { error: "rate_limited" },
    });
  });

  it("他のAIエラーは従来どおり502", async () => {
    failWith(new AiProviderError(502, "overloaded"));
    expect(await call(handler, body)).toEqual({
      status: 502,
      json: { error: "overloaded" },
    });
  });
});
