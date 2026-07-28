import type { TriggerKey } from "../shared/contracts.js";

interface ModifierKeyEvent {
  key: string;
}

interface ModifierStateEvent {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const EVENT_KEY_BY_TRIGGER: Record<TriggerKey, string> = {
  control: "Control",
  alt: "Alt",
  meta: "Meta"
};

export function isTriggerKeyEvent(
  event: ModifierKeyEvent,
  triggerKey: TriggerKey
): boolean {
  return event.key === EVENT_KEY_BY_TRIGGER[triggerKey];
}

export function isTriggerModifierPressed(
  event: ModifierStateEvent,
  triggerKey: TriggerKey
): boolean {
  return (
    event.shiftKey === false &&
    event.ctrlKey === (triggerKey === "control") &&
    event.altKey === (triggerKey === "alt") &&
    event.metaKey === (triggerKey === "meta")
  );
}
