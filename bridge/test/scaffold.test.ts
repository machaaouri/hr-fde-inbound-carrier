import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server/build-app.ts";

describe("bridge scaffold", () => {
  it("exports buildApp", () => {
    expect(typeof buildApp).toBe("function");
  });
});
