import { describe, it, expect, afterEach } from "vitest";
import { getModel } from "./gemini.js";

describe("getModel", () => {
  const original = process.env.GEMINI_MODEL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = original;
    }
  });

  it("GEMINI_MODEL未設定ならデフォルト(gemini-3.6-flash)を返す", () => {
    delete process.env.GEMINI_MODEL;
    expect(getModel()).toBe("gemini-3.6-flash");
  });

  it("GEMINI_MODELが設定されていればそれを使う", () => {
    process.env.GEMINI_MODEL = "gemini-custom";
    expect(getModel()).toBe("gemini-custom");
  });

  it("GEMINI_MODELが空白のみならデフォルトを使う", () => {
    process.env.GEMINI_MODEL = "   ";
    expect(getModel()).toBe("gemini-3.6-flash");
  });
});
