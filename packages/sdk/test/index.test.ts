import { describe, expect, it } from "vitest";
import { SDK_VERSION } from "../src/index";

describe("@satpad/sdk", () => {
  it("exports a version", () => {
    expect(SDK_VERSION).toBe("0.0.1");
  });
});
