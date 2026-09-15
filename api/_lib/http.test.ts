import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, readJsonBody } from "./http.js";

/** テスト用の最小限のServerResponseフェイク。 */
function createFakeResponse() {
  let headersSent = false;
  let writableEnded = false;
  let statusCode = 0;
  const headers: Record<string, string> = {};
  const endedBodies: (string | undefined)[] = [];

  const res = {
    get headersSent() {
      return headersSent;
    },
    get writableEnded() {
      return writableEnded;
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    end(body?: string) {
      // 実際のNodeもres.end()の時点でヘッダーがフラッシュされ、
      // headersSent/writableEndedがtrueになる。
      headersSent = true;
      writableEnded = true;
      endedBodies.push(body);
    },
  };

  return {
    res: res as unknown as ServerResponse,
    headers,
    endedBodies,
    getStatusCode: () => statusCode,
  };
}

function createStreamRequest(): PassThrough {
  return new PassThrough();
}

function asRequest(stream: PassThrough): IncomingMessage & { body?: unknown } {
  return stream as unknown as IncomingMessage & { body?: unknown };
}

describe("sendJson", () => {
  it("1回目はstatusCode/Content-Type/bodyを設定して送信する", () => {
    const { res, headers, endedBodies, getStatusCode } = createFakeResponse();
    sendJson(res, 200, { ok: true });
    expect(getStatusCode()).toBe(200);
    expect(headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(endedBodies).toEqual([JSON.stringify({ ok: true })]);
  });

  it("headersSent後の2回目の呼び出しはno-op", () => {
    const { res, endedBodies, getStatusCode } = createFakeResponse();
    sendJson(res, 200, { ok: true });
    sendJson(res, 500, { error: "internal_error" });
    expect(endedBodies).toHaveLength(1);
    expect(getStatusCode()).toBe(200);
  });
});

describe("readJsonBody", () => {
  it("req.bodyがオブジェクトならそのまま返す", async () => {
    const req = { body: { a: 1 } } as unknown as IncomingMessage & {
      body?: unknown;
    };
    await expect(readJsonBody(req)).resolves.toEqual({ a: 1 });
  });

  it("req.bodyが文字列ならJSON.parseする", async () => {
    const req = { body: '{"a":1}' } as unknown as IncomingMessage & {
      body?: unknown;
    };
    await expect(readJsonBody(req)).resolves.toEqual({ a: 1 });
  });

  it("req.bodyが不正なJSON文字列ならundefined", async () => {
    const req = { body: "not valid json" } as unknown as IncomingMessage & {
      body?: unknown;
    };
    await expect(readJsonBody(req)).resolves.toBeUndefined();
  });

  it("req.bodyがBufferならtoString+JSON.parseする", async () => {
    const req = {
      body: Buffer.from('{"a":1}', "utf-8"),
    } as unknown as IncomingMessage & { body?: unknown };
    await expect(readJsonBody(req)).resolves.toEqual({ a: 1 });
  });

  it("req.bodyが無ければストリームのBufferチャンクから読む", async () => {
    const req = createStreamRequest();
    req.write(Buffer.from('{"a":2}', "utf-8"));
    req.end();
    await expect(readJsonBody(asRequest(req))).resolves.toEqual({ a: 2 });
  });

  it("ストリームが文字列チャンクを流す場合も扱える(setEncoding済み)", async () => {
    const req = createStreamRequest();
    req.setEncoding("utf-8");
    req.write('{"a":3}');
    req.end();
    await expect(readJsonBody(asRequest(req))).resolves.toEqual({ a: 3 });
  });

  it("ストリームの内容が不正なJSONならundefined", async () => {
    const req = createStreamRequest();
    req.write("not json");
    req.end();
    await expect(readJsonBody(asRequest(req))).resolves.toBeUndefined();
  });

  it("ストリームが空ならundefined", async () => {
    const req = createStreamRequest();
    req.end();
    await expect(readJsonBody(asRequest(req))).resolves.toBeUndefined();
  });

  it("1MiBを超えたら読み込みを止めてundefinedを返す", async () => {
    const req = createStreamRequest();
    const chunk = Buffer.alloc(256 * 1024, "a");
    // 5 * 256KiB = 1.25MiB > 1MiB
    for (let i = 0; i < 5; i++) {
      req.write(chunk);
    }
    req.end();
    await expect(readJsonBody(asRequest(req))).resolves.toBeUndefined();
  });
});
