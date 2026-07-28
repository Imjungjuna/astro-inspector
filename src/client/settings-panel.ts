import {
  TRIGGER_KEYS,
  type TriggerKey
} from "../shared/contracts.js";
import { FOX_MARK_PATH } from "./fox-mark.js";

const LAUNCHER_POSITION_KEY =
  "astro-ai-locator:launcher-position:v1";
const POPOVER_ID = "astro-ai-locator-settings-popover";
const VIEWPORT_GAP = 12;
const DEFAULT_EDGE_GAP = 16;
const LAUNCHER_SIZE = 46;
const POPOVER_GAP = 6;
const DRAG_THRESHOLD = 5;

interface LauncherPosition {
  x: number;
  y: number;
}

interface SettingsPanelOptions {
  triggerKey: TriggerKey;
  onTriggerKeyChange(triggerKey: TriggerKey): Promise<boolean>;
}

export interface LocatorSettingsPanel {
  setTriggerKey(triggerKey: TriggerKey): void;
  destroy(): void;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function readPosition(): LauncherPosition | null {
  const serialized = readStorage(LAUNCHER_POSITION_KEY);
  if (!serialized) {
    return null;
  }
  try {
    const value = JSON.parse(serialized) as Partial<LauncherPosition>;
    if (Number.isFinite(value.x) && Number.isFinite(value.y)) {
      return { x: Number(value.x), y: Number(value.y) };
    }
  } catch {
    // Invalid local UI state must not prevent the locator from loading.
  }
  return null;
}

export function createSettingsPanel(
  options: SettingsPanelOptions
): LocatorSettingsPanel {
  const host = document.createElement("div");
  host.dataset.astroAiLocatorSettings = "";
  host.dataset.astroAiLocatorUi = "";
  host.style.cssText = [
    "position:fixed",
    `left:${DEFAULT_EDGE_GAP}px`,
    `bottom:${DEFAULT_EDGE_GAP}px`,
    `width:${LAUNCHER_SIZE}px`,
    `height:${LAUNCHER_SIZE}px`,
    "z-index:2147483647",
    "pointer-events:none"
  ].join(";");

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host {
        color-scheme: dark;
      }
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }
      .launcher {
        position: absolute;
        inset: 0;
        display: grid;
        width: ${LAUNCHER_SIZE}px;
        height: ${LAUNCHER_SIZE}px;
        padding: 0;
        place-items: center;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 999px;
        background: rgba(7, 7, 16, 0.62);
        color: white;
        -webkit-backdrop-filter: blur(14px);
        backdrop-filter: blur(14px);
        box-shadow:
          0 8px 20px rgba(15, 23, 42, 0.18),
          0 2px 6px rgba(15, 23, 42, 0.12);
        cursor: pointer;
        pointer-events: auto;
        touch-action: none;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      }
      .launcher:hover {
        background: rgba(75, 85, 99, 0.78);
      }
      .launcher:active {
        cursor: pointer;
      }
      .launcher:focus-visible {
        outline: 2px solid #a1a1aa;
        outline-offset: 3px;
        box-shadow:
          0 0 0 2px #ffffff,
          0 8px 20px rgba(15, 23, 42, 0.18);
      }
      .fox-mark {
        display: block;
        width: 25px;
        height: 25px;
      }
      .popover {
        --popover-offset-x: 0px;
        --arrow-left: 26px;
        position: absolute;
        left: var(--popover-offset-x);
        bottom: ${LAUNCHER_SIZE + POPOVER_GAP}px;
        width: min(260px, calc(100vw - ${VIEWPORT_GAP * 2}px));
        overflow: visible;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 10px;
        background: rgba(63, 63, 70, 0.8);
        color: #f4f4f5;
        -webkit-backdrop-filter: blur(18px);
        backdrop-filter: blur(18px);
        box-shadow:
          0 10px 15px -3px rgba(0, 0, 0, 0.10),
          0 4px 6px -4px rgba(0, 0, 0, 0.10);
        font-family: ui-sans-serif, system-ui, -apple-system,
          BlinkMacSystemFont, "Segoe UI", sans-serif;
        opacity: 0;
        pointer-events: none;
        transform: translateY(6px) scale(0.98);
        transform-origin: var(--arrow-left) bottom;
        transition:
          opacity 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
          transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1),
          visibility 0s linear 160ms;
        visibility: hidden;
      }
      .popover[data-placement="below"] {
        top: ${LAUNCHER_SIZE + POPOVER_GAP}px;
        bottom: auto;
        transform: translateY(-6px) scale(0.98);
        transform-origin: var(--arrow-left) top;
      }
      .popover[data-open] {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0) scale(1);
        transition-delay: 0s;
        visibility: visible;
      }
      .trigger-section,
      .preferences-section {
        padding: 8px;
      }
      .section-heading {
        margin: 0 4px 6px;
        color: #f4f4f5;
        font-size: 12px;
        font-weight: 600;
        line-height: 18px;
      }
      .choices {
        display: flex;
        flex-direction: column;
        gap: 0;
      }
      .choice {
        display: grid;
        width: 100%;
        height: 28px;
        min-width: 0;
        padding: 0 4px;
        align-items: center;
        grid-template-columns: 24px minmax(0, 1fr);
        gap: 7px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #fafafa;
        cursor: pointer;
        font: 400 13px/18px ui-sans-serif, system-ui, -apple-system,
          BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-align: left;
        transition:
          background-color 120ms ease,
          color 120ms ease,
          box-shadow 120ms ease;
      }
      .choice:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px #71717a;
      }
      .choice[aria-pressed="true"] {
        background: transparent;
        color: #fafafa;
      }
      .choice:hover,
      .choice[aria-pressed="true"]:hover {
        background: rgba(255, 255, 255, 0.14);
        color: #fafafa;
      }
      .keycap {
        display: grid;
        width: 22px;
        height: 22px;
        place-items: center;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
        font: 600 16px/1 ui-monospace, SFMono-Regular, Menlo, Monaco,
          Consolas, monospace;
      }
      .choice[aria-pressed="true"] .keycap {
        border-color: #7c3aed;
        background: #7c3aed;
        color: #ffffff;
      }
      .choice:disabled {
        cursor: wait;
        opacity: 0.62;
      }
      .divider {
        height: 1px;
        margin: 0;
        background: rgba(255, 255, 255, 0.14);
      }
      .preference-row {
        display: flex;
        height: 28px;
        padding: 0 4px;
        align-items: center;
        justify-content: space-between;
        border-radius: 6px;
        color: #fafafa;
        font-size: 13px;
        font-weight: 400;
        line-height: 18px;
      }
      .chips {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .chip {
        display: block;
        width: 18px;
        height: 18px;
        border: 2px solid rgba(63, 63, 70, 0.8);
        border-radius: 999px;
        box-shadow: 0 0 0 1px #52525b;
      }
      @media (prefers-reduced-motion: reduce) {
        .launcher,
        .choice,
        .popover {
          transition: none;
        }
        .popover,
        .popover[data-placement="below"],
        .popover[data-open] {
          transform: none;
        }
      }
    </style>
    <section
      class="popover"
      id="${POPOVER_ID}"
      data-astro-ai-locator-popover
      data-placement="above"
      role="dialog"
      aria-label="Astro AI Locator settings"
      aria-hidden="true"
    >
      <div class="trigger-section">
        <p class="section-heading">Trigger</p>
        <div class="choices">
          <button class="choice" type="button" data-trigger-key="control">
            <span class="keycap" data-modifier-keycap aria-hidden="true">⌃</span>
            <span>Control</span>
          </button>
          <button class="choice" type="button" data-trigger-key="alt">
            <span class="keycap" data-modifier-keycap aria-hidden="true">⌥</span>
            <span>Option / Alt</span>
          </button>
          <button class="choice" type="button" data-trigger-key="meta">
            <span class="keycap" data-modifier-keycap aria-hidden="true">⌘</span>
            <span>Command / Meta</span>
          </button>
        </div>
      </div>
      <div class="divider" aria-hidden="true"></div>
      <div class="preferences-section">
        <p class="section-heading">Preferences</p>
        <div class="preference-row">
          <span>Overlay Color</span>
          <span class="chips" aria-hidden="true">
            <span class="chip" data-ui-color-chip style="background:#111111"></span>
            <span class="chip" data-ui-color-chip style="background:#7c3aed"></span>
            <span class="chip" data-ui-color-chip style="background:#f97316"></span>
            <span class="chip" data-ui-color-chip style="background:#0ea5e9"></span>
          </span>
        </div>
      </div>
    </section>
    <button
      class="launcher"
      data-astro-ai-locator-launcher
      type="button"
      aria-expanded="false"
      aria-controls="${POPOVER_ID}"
      aria-label="Open Astro AI Locator settings"
    >
      <svg
        class="fox-mark"
        data-fox-mark
        viewBox="0 0 512 512"
        aria-hidden="true"
        focusable="false"
      >
        <path d="${FOX_MARK_PATH}" fill="white"></path>
      </svg>
    </button>
  `;
  document.documentElement.append(host);

  const launcher = shadow.querySelector<HTMLButtonElement>(
    "[data-astro-ai-locator-launcher]"
  );
  const popover = shadow.querySelector<HTMLElement>(
    "[data-astro-ai-locator-popover]"
  );
  const choiceButtons = Array.from(
    shadow.querySelectorAll<HTMLButtonElement>("[data-trigger-key]")
  );
  if (!launcher || !popover) {
    host.remove();
    throw new Error("Locator settings UI could not initialize");
  }

  let currentTriggerKey = options.triggerKey;
  let position = readPosition();
  let open = false;
  let pointerActive = false;
  let dragging = false;
  let suppressNextClick = false;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let launcherStartX = 0;
  let launcherStartY = 0;

  const clampPosition = (next: LauncherPosition): LauncherPosition => ({
    x: Math.min(
      Math.max(next.x, VIEWPORT_GAP),
      Math.max(VIEWPORT_GAP, window.innerWidth - LAUNCHER_SIZE - VIEWPORT_GAP)
    ),
    y: Math.min(
      Math.max(next.y, VIEWPORT_GAP),
      Math.max(VIEWPORT_GAP, window.innerHeight - LAUNCHER_SIZE - VIEWPORT_GAP)
    )
  });

  const updatePopoverPlacement = () => {
    const launcherRect = launcher.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const popoverWidth = popoverRect.width;
    const popoverHeight = popoverRect.height;
    const minLeft = VIEWPORT_GAP;
    const maxLeft = Math.max(
      minLeft,
      window.innerWidth - popoverWidth - VIEWPORT_GAP
    );
    const popoverLeft = Math.min(Math.max(launcherRect.left, minLeft), maxLeft);
    const offsetX = popoverLeft - launcherRect.left;
    const arrowLeft = Math.min(
      Math.max(launcherRect.width / 2 - offsetX, 18),
      Math.max(18, popoverWidth - 18)
    );
    const fitsAbove =
      launcherRect.top - POPOVER_GAP - popoverHeight >= VIEWPORT_GAP;

    popover.dataset.placement = fitsAbove ? "above" : "below";
    popover.style.setProperty("--popover-offset-x", `${offsetX}px`);
    popover.style.setProperty("--arrow-left", `${arrowLeft}px`);
  };

  const applyPosition = (
    next: LauncherPosition,
    persist = false
  ): void => {
    position = clampPosition(next);
    host.style.left = `${position.x}px`;
    host.style.top = `${position.y}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
    updatePopoverPlacement();
    if (persist) {
      writeStorage(LAUNCHER_POSITION_KEY, JSON.stringify(position));
    }
  };

  const setOpen = (nextOpen: boolean, restoreFocus = false) => {
    open = nextOpen;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute(
      "aria-label",
      open
        ? "Close Astro AI Locator settings"
        : "Open Astro AI Locator settings"
    );
    popover.setAttribute("aria-hidden", String(!open));
    popover.toggleAttribute("data-open", open);
    if (open) {
      updatePopoverPlacement();
    } else if (restoreFocus) {
      launcher.focus();
    }
  };

  const updateSelectedKey = () => {
    choiceButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.triggerKey === currentTriggerKey)
      );
    });
  };

  choiceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const triggerKey = button.dataset.triggerKey;
      if (
        !TRIGGER_KEYS.includes(triggerKey as TriggerKey) ||
        triggerKey === currentTriggerKey
      ) {
        return;
      }
      choiceButtons.forEach((choice) => {
        choice.disabled = true;
      });
      void options
        .onTriggerKeyChange(triggerKey as TriggerKey)
        .then((accepted) => {
          if (accepted) {
            currentTriggerKey = triggerKey as TriggerKey;
            updateSelectedKey();
          }
        })
        .finally(() => {
          choiceButtons.forEach((choice) => {
            choice.disabled = false;
          });
        });
    });
  });

  launcher.addEventListener("click", (event) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      event.preventDefault();
      return;
    }
    setOpen(!open);
  });

  launcher.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    const rect = launcher.getBoundingClientRect();
    pointerActive = true;
    dragging = false;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    launcherStartX = rect.left;
    launcherStartY = rect.top;
    launcher.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  launcher.addEventListener("pointermove", (event) => {
    if (!pointerActive) {
      return;
    }
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    if (!dragging && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) {
      return;
    }
    dragging = true;
    applyPosition({
      x: launcherStartX + deltaX,
      y: launcherStartY + deltaY
    });
  });

  const finishPointer = (event: PointerEvent) => {
    if (!pointerActive) {
      return;
    }
    pointerActive = false;
    if (launcher.hasPointerCapture(event.pointerId)) {
      launcher.releasePointerCapture(event.pointerId);
    }
    if (dragging && position) {
      applyPosition(position, true);
      suppressNextClick = true;
      window.setTimeout(() => {
        suppressNextClick = false;
      }, 0);
    }
    dragging = false;
  };
  launcher.addEventListener("pointerup", finishPointer);
  launcher.addEventListener("pointercancel", finishPointer);

  shadow.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const target = event.target;
    if (target instanceof HTMLButtonElement) {
      target.click();
    }
  });

  const onOutsidePointerDown = (event: PointerEvent) => {
    if (open && !event.composedPath().includes(host)) {
      setOpen(false);
    }
  };
  const onEscape = (event: KeyboardEvent) => {
    if (open && event.key === "Escape") {
      setOpen(false, true);
    }
  };
  const onResize = () => {
    if (position) {
      applyPosition(position, true);
      return;
    }
    updatePopoverPlacement();
  };

  document.addEventListener("pointerdown", onOutsidePointerDown, true);
  window.addEventListener("keydown", onEscape, true);
  window.addEventListener("resize", onResize);

  if (position) {
    applyPosition(position);
  } else {
    updatePopoverPlacement();
  }
  updateSelectedKey();

  return {
    setTriggerKey(triggerKey) {
      currentTriggerKey = triggerKey;
      updateSelectedKey();
    },
    destroy() {
      document.removeEventListener(
        "pointerdown",
        onOutsidePointerDown,
        true
      );
      window.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("resize", onResize);
      host.remove();
    }
  };
}
