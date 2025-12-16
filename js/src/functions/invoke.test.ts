import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { initFunction } from "./invoke";
import { _internalGetGlobalState, _exportsForTestingOnly } from "../logger";

describe("initFunction", () => {
  beforeEach(() => {
    _exportsForTestingOnly.setInitialTestState();
  });

  afterEach(() => {
    _exportsForTestingOnly.clearTestBackgroundLogger();
  });

  test("should disable span cache when called", async () => {
    const state = _internalGetGlobalState();

    // Cache should not be disabled initially
    expect(state.spanCache.disabled).toBe(false);

    // Call initFunction
    initFunction({
      projectName: "test-project",
      slug: "test-function",
    });

    // Cache should now be disabled
    expect(state.spanCache.disabled).toBe(true);
  });

  test("should return a function with correct name", () => {
    const fn = initFunction({
      projectName: "my-project",
      slug: "my-scorer",
      version: "v1",
    });

    expect(fn.name).toBe("initFunction-my-project-my-scorer-v1");
  });

  test("should use 'latest' in name when version not specified", () => {
    const fn = initFunction({
      projectName: "my-project",
      slug: "my-scorer",
    });

    expect(fn.name).toBe("initFunction-my-project-my-scorer-latest");
  });
});
