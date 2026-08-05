import { describe, expect, it, vi } from "vitest";
import { createSessionState } from "../../src/integration/session-state.js";

describe("createSessionState", () => {
  it("starts enabled", () => {
    expect(createSessionState().isDisabled()).toBe(false);
  });

  it("stays disabled once disabled", () => {
    const state = createSessionState();
    state.disable();
    state.disable();
    expect(state.isDisabled()).toBe(true);
  });

  it("runs every listener once on the first disable", () => {
    const state = createSessionState();
    const first = vi.fn();
    const second = vi.fn();
    state.onDisable(first);
    state.onDisable(second);

    state.disable();
    state.disable();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("runs a listener registered after disable immediately", () => {
    const state = createSessionState();
    state.disable();
    const listener = vi.fn();

    state.onDisable(listener);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
