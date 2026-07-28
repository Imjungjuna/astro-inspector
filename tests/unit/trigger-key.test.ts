import { describe, expect, it } from "vitest";
import {
  isTriggerKeyEvent,
  isTriggerModifierPressed
} from "../../src/client/trigger-key.js";
import type { TriggerKey } from "../../src/shared/contracts.js";

describe("trigger-key matching", () => {
  it.each([
    ["control", "Control", true],
    ["control", "Alt", false],
    ["alt", "Alt", true],
    ["alt", "Meta", false],
    ["meta", "Meta", true],
    ["meta", "Control", false]
  ] satisfies [TriggerKey, string, boolean][])(
    "matches %s to its physical modifier key",
    (triggerKey, eventKey, expected) => {
      expect(isTriggerKeyEvent({ key: eventKey }, triggerKey)).toBe(expected);
    }
  );

  it.each([
    ["control", true, false, false, false, true],
    ["alt", false, true, false, false, true],
    ["meta", false, false, true, false, true],
    ["control", true, true, false, false, false],
    ["alt", false, true, true, false, false],
    ["meta", true, false, true, false, false],
    ["alt", false, true, false, true, false],
    ["control", false, false, false, false, false]
  ] satisfies [TriggerKey, boolean, boolean, boolean, boolean, boolean][])(
    "requires an exact %s-only modifier combination",
    (triggerKey, ctrlKey, altKey, metaKey, shiftKey, expected) => {
      expect(
        isTriggerModifierPressed(
          { ctrlKey, altKey, metaKey, shiftKey },
          triggerKey
        )
      ).toBe(expected);
    }
  );
});
