import {
  COLOR_PRESETS,
  PARENT_LEVELS,
  TRIGGER_KEYS,
  type ColorPreset,
  type ContextField,
  type CopyMode,
  type LocationFormat,
  type LocatorSettings,
  type ParentLevels,
  type TriggerKey
} from "../shared/contracts.js";
import {
  LOCATOR_COLOR_THEMES,
  applyColorPreset
} from "./color-presets.js";
import { FOX_MARK_PATH } from "./fox-mark.js";
import { HIDE_MARK_SVG } from "./hide-mark.js";

const LAUNCHER_POSITION_KEY =
  "astro-ai-locator:launcher-position:v1";
const POPOVER_ID = "astro-ai-locator-settings-popover";
const CONTEXT_OPTIONS_ID = "astro-ai-locator-context-options";
const LOCATION_FORMAT_OPTIONS_ID =
  "astro-ai-locator-location-format-options";
const VIEWPORT_GAP = 12;
const DEFAULT_EDGE_GAP = 16;
const LAUNCHER_SIZE = 46;
const POPOVER_GAP = 6;
const COPY_FEEDBACK_MS = 1800;
const DRAG_THRESHOLD = 5;

interface LauncherPosition {
  x: number;
  y: number;
}

interface SettingsPanelOptions {
  settings: LocatorSettings;
  onSettingsChange(
    settings: LocatorSettings
  ): Promise<LocatorSettings | null>;
  onCopyMcpPrompt(): Promise<boolean>;
  onQuit(): Promise<void>;
  onHide(): void;
}

export interface LocatorSettingsPanel {
  setSettings(settings: LocatorSettings): void;
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
  const colorButtonsMarkup = COLOR_PRESETS.map((preset) => {
    const label = `${preset[0]?.toUpperCase()}${preset.slice(1)}`;
    return `<button class="chip" type="button" data-ui-color-chip data-color-preset="${preset}" aria-label="${label}" aria-pressed="false" style="--chip-color:${LOCATOR_COLOR_THEMES[preset].swatch}"></button>`;
  }).join("");
  const parentLevelButtonsMarkup = PARENT_LEVELS.map(
    (level) =>
      `<button class="level-button" type="button" data-parent-level="${level}" aria-label="${level}" aria-pressed="false">${level}</button>`
  ).join("");
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
      .copy-section,
      .preferences-section {
        padding: 8px;
      }
      .footer {
        display: grid;
        grid-template-columns: 28px 1fr 1fr;
        gap: 6px;
        padding: 8px;
        border-top: 1px solid rgba(255, 255, 255, 0.14);
      }
      .footer-icon {
        display: grid;
        padding: 0;
        place-items: center;
      }
      .footer-icon svg {
        width: 14px;
        height: 14px;
        fill: #f4f4f5;
      }
      .footer-button {
        padding: 0 8px;
        height: 28px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.06);
        color: #f4f4f5;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        font-weight: 500;
        line-height: 18px;
        white-space: nowrap;
      }
      .footer-button:hover {
        background: rgba(255, 255, 255, 0.14);
      }
      /* Tracks the active overlay preset; applyColorPreset re-runs on change. */
      .footer-button[data-ui-copy-mcp] {
        border-color: transparent;
        background: var(--locator-solid);
      }
      .footer-button[data-ui-copy-mcp]:hover {
        background: var(--locator-solid);
        filter: brightness(1.12);
      }
      .footer-button:focus-visible {
        outline: 2px solid #a1a1aa;
        outline-offset: 2px;
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
        font: 400 16px/1 ui-monospace, SFMono-Regular, Menlo, Monaco,
          Consolas, monospace;
      }
      .choice[aria-pressed="true"] .keycap {
        border-color: var(--locator-solid);
        background: var(--locator-solid);
        color: #ffffff;
      }
      .copy-mode-row {
        width: 100%;
      }
      .copy-mode-choice[aria-checked="true"] .keycap {
        border-color: var(--locator-solid);
        background: var(--locator-solid);
        color: #ffffff;
      }
      .context-mode-choice {
        grid-template-columns: 24px minmax(0, 1fr) 18px;
      }
      .context-cue {
        display: block;
        color: rgba(255, 255, 255, 0.72);
        font: 400 18px/1 ui-sans-serif, system-ui, sans-serif;
        pointer-events: none;
        text-align: center;
        transform: rotate(0deg);
        transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .context-mode-choice[aria-expanded="true"] .context-cue {
        transform: rotate(90deg);
      }
      .option-row:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px #71717a;
      }
      .collapsible {
        display: grid;
        grid-template-rows: 0fr;
        opacity: 0;
        transition:
          grid-template-rows 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
          opacity 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      .collapsible[data-expanded] {
        grid-template-rows: 1fr;
        opacity: 1;
      }
      .collapsible-inner {
        min-height: 0;
        overflow: hidden;
      }
      .context-options-surface {
        padding: 4px 8px 6px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.06);
      }
      .option-row {
        display: grid;
        width: calc(100% - 16px);
        height: 28px;
        margin-left: 16px;
        padding: 0 4px;
        align-items: center;
        grid-template-columns: 18px minmax(0, 1fr);
        gap: 5px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #fafafa;
        cursor: pointer;
        font: 400 13px/18px ui-sans-serif, system-ui, -apple-system,
          BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-align: left;
      }
      .option-row:hover {
        background: rgba(255, 255, 255, 0.14);
      }
      .option-row:disabled {
        color: rgba(255, 255, 255, 0.38);
        cursor: default;
      }
      .option-row:disabled:hover {
        background: transparent;
      }
      .option-check {
        display: block;
        width: 18px;
        color: #ffffff;
        font-size: 15px;
        line-height: 1;
        text-align: center;
      }
      .location-format-options .option-row {
        width: calc(100% - 34px);
        margin-left: 34px;
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
        padding: 0;
        appearance: none;
        border: 2px solid rgba(63, 63, 70, 0.8);
        border-radius: 999px;
        background: var(--chip-color);
        box-shadow: 0 0 0 1px #52525b;
        cursor: pointer;
      }
      .chip[aria-pressed="true"] {
        box-shadow:
          0 0 0 2px rgba(63, 63, 70, 0.8),
          0 0 0 4px var(--locator-solid);
      }
      .chip:focus-visible {
        outline: 2px solid #ffffff;
        outline-offset: 2px;
      }
      .chip:disabled {
        cursor: wait;
        opacity: 0.62;
      }
      .level-group {
        display: flex;
        align-items: center;
        gap: 3px;
      }
      .level-button {
        display: grid;
        width: 22px;
        height: 22px;
        padding: 0;
        place-items: center;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.1);
        color: #ffffff;
        cursor: pointer;
        font: 400 12px/1 ui-monospace, SFMono-Regular, Menlo, Monaco,
          Consolas, monospace;
      }
      .level-button:hover {
        background: rgba(255, 255, 255, 0.14);
      }
      .level-button[aria-pressed="true"] {
        border-color: var(--locator-solid);
        background: var(--locator-solid);
      }
      .level-button:focus-visible {
        outline: 2px solid #ffffff;
        outline-offset: 2px;
      }
      .level-button:disabled {
        cursor: wait;
        opacity: 0.62;
      }
      @media (prefers-reduced-motion: reduce) {
        .launcher,
        .choice,
        .collapsible,
        .context-cue,
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
      aria-label="Astro Inspector settings"
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
      <div class="copy-section" data-copy-as-section>
        <p class="section-heading">Copy As</p>
        <div role="radiogroup" aria-label="Copy mode">
          <div class="copy-mode-row">
            <button
              class="choice copy-mode-choice"
              type="button"
              role="radio"
              aria-checked="false"
              data-copy-mode="hash"
            >
              <span class="keycap" data-copy-mode-keycap aria-hidden="true">#</span>
              <span>Hash</span>
            </button>
          </div>
          <div class="copy-mode-row">
            <button
              class="choice copy-mode-choice context-mode-choice"
              type="button"
              role="radio"
              aria-checked="false"
              aria-expanded="false"
              aria-controls="${CONTEXT_OPTIONS_ID}"
              data-copy-mode="context"
            >
              <span class="keycap" data-copy-mode-keycap aria-hidden="true">@</span>
              <span>Context</span>
              <span class="context-cue" data-context-cue aria-hidden="true">›</span>
            </button>
          </div>
        </div>
        <div
          class="collapsible context-options"
          id="${CONTEXT_OPTIONS_ID}"
          data-context-options
          aria-hidden="true"
        >
          <div class="collapsible-inner">
            <div class="context-options-surface">
              <button
                class="option-row"
                type="button"
                role="checkbox"
                aria-checked="false"
                data-context-field="tag"
                tabindex="-1"
              >
                <span class="option-check" aria-hidden="true"></span>
                <span>Tag</span>
              </button>
              <button
                class="option-row"
                type="button"
                role="checkbox"
                aria-checked="false"
                aria-controls="${LOCATION_FORMAT_OPTIONS_ID}"
                data-context-field="location"
                tabindex="-1"
              >
                <span class="option-check" aria-hidden="true"></span>
                <span>Location</span>
              </button>
              <div
                class="collapsible location-format-options"
                id="${LOCATION_FORMAT_OPTIONS_ID}"
                data-location-format-options
                role="radiogroup"
                aria-label="Location format"
                aria-hidden="true"
              >
                <div class="collapsible-inner">
                  <button
                    class="option-row"
                    type="button"
                    role="radio"
                    aria-checked="false"
                    data-location-format="path"
                    tabindex="-1"
                  >
                    <span class="option-check" aria-hidden="true"></span>
                    <span>Path</span>
                  </button>
                  <button
                    class="option-row"
                    type="button"
                    role="radio"
                    aria-checked="false"
                    data-location-format="moduleName"
                    tabindex="-1"
                  >
                    <span class="option-check" aria-hidden="true"></span>
                    <span>Module name</span>
                  </button>
                </div>
              </div>
              <button
                class="option-row"
                type="button"
                role="checkbox"
                aria-checked="false"
                data-context-field="line"
                tabindex="-1"
              >
                <span class="option-check" aria-hidden="true"></span>
                <span>Line</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="divider" aria-hidden="true"></div>
      <div class="preferences-section">
        <p class="section-heading">Preferences</p>
        <div class="preference-row">
          <span>Overlay Color</span>
          <span class="chips" role="group" aria-label="Overlay color">
            ${colorButtonsMarkup}
          </span>
        </div>
        <div class="preference-row">
          <span>Parent Levels</span>
          <span class="level-group" role="group" aria-label="Parent levels">
            ${parentLevelButtonsMarkup}
          </span>
        </div>
      </div>
      <div class="footer">
        <button
          class="footer-button footer-icon"
          type="button"
          data-ui-hide
          aria-label="Hide the button until reload"
          title="Hide the button until reload"
        >${HIDE_MARK_SVG}</button>
        <button class="footer-button" type="button" data-ui-quit>
          Quit Extension
        </button>
        <button class="footer-button" type="button" data-ui-copy-mcp>
          Copy MCP Prompt
        </button>
      </div>
    </section>
    <button
      class="launcher"
      data-astro-ai-locator-launcher
      type="button"
      aria-expanded="false"
      aria-controls="${POPOVER_ID}"
      aria-label="Open Astro Inspector settings"
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
  applyColorPreset(host, options.settings.colorPreset);
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
  const colorButtons = Array.from(
    shadow.querySelectorAll<HTMLButtonElement>("[data-color-preset]")
  );
  const parentLevelButtons = Array.from(
    shadow.querySelectorAll<HTMLButtonElement>("[data-parent-level]")
  );
  const copyModeButtons = Array.from(
    shadow.querySelectorAll<HTMLButtonElement>("[data-copy-mode]")
  );
  const contextFieldButtons = Array.from(
    shadow.querySelectorAll<HTMLButtonElement>("[data-context-field]")
  );
  const locationFormatButtons = Array.from(
    shadow.querySelectorAll<HTMLButtonElement>("[data-location-format]")
  );
  const contextModeButton = shadow.querySelector<HTMLButtonElement>(
    '[data-copy-mode="context"]'
  );
  const contextOptions = shadow.querySelector<HTMLElement>(
    "[data-context-options]"
  );
  const locationFormatOptions = shadow.querySelector<HTMLElement>(
    "[data-location-format-options]"
  );
  if (
    !launcher ||
    !popover ||
    !contextModeButton ||
    !contextOptions ||
    !locationFormatOptions
  ) {
    host.remove();
    throw new Error("Locator settings UI could not initialize");
  }

  let currentSettings = options.settings;
  let position = readPosition();
  let open = false;
  let contextExpanded = false;
  let settingsWritePending = false;
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
        ? "Close Astro Inspector settings"
        : "Open Astro Inspector settings"
    );
    popover.setAttribute("aria-hidden", String(!open));
    popover.toggleAttribute("data-open", open);
    if (open) {
      updatePopoverPlacement();
    } else if (restoreFocus) {
      launcher.focus();
    }
  };

  const settingsButtons = [
    ...choiceButtons,
    ...copyModeButtons,
    ...contextFieldButtons,
    ...locationFormatButtons,
    ...colorButtons,
    ...parentLevelButtons
  ];

  const updateButtonAvailability = () => {
    const locationSelected =
      currentSettings.contextFields.includes("location");
    settingsButtons.forEach((button) => {
      button.disabled = settingsWritePending;
    });
    const lineButton = contextFieldButtons.find(
      (button) => button.dataset.contextField === "line"
    );
    if (lineButton) {
      lineButton.disabled = settingsWritePending || !locationSelected;
    }
  };

  const updateDisclosure = () => {
    const locationSelected =
      currentSettings.contextFields.includes("location");
    const formatExpanded = contextExpanded && locationSelected;
    contextModeButton.setAttribute(
      "aria-expanded",
      String(contextExpanded)
    );
    contextOptions.toggleAttribute("data-expanded", contextExpanded);
    contextOptions.setAttribute("aria-hidden", String(!contextExpanded));
    contextOptions.inert = !contextExpanded;
    contextFieldButtons.forEach((button) => {
      button.tabIndex = contextExpanded ? 0 : -1;
    });

    locationFormatOptions.toggleAttribute(
      "data-expanded",
      formatExpanded
    );
    locationFormatOptions.setAttribute(
      "aria-hidden",
      String(!formatExpanded)
    );
    locationFormatOptions.inert = !formatExpanded;
    locationFormatButtons.forEach((button) => {
      button.tabIndex = formatExpanded ? 0 : -1;
    });
    window.requestAnimationFrame(updatePopoverPlacement);
  };

  const updateSelectedSettings = () => {
    choiceButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.triggerKey === currentSettings.triggerKey)
      );
    });
    colorButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.colorPreset === currentSettings.colorPreset)
      );
    });
    parentLevelButtons.forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(
          Number(button.dataset.parentLevel) ===
            currentSettings.parentLevels
        )
      );
    });
    copyModeButtons.forEach((button) => {
      button.setAttribute(
        "aria-checked",
        String(button.dataset.copyMode === currentSettings.copyMode)
      );
    });
    contextFieldButtons.forEach((button) => {
      const selected = currentSettings.contextFields.includes(
        button.dataset.contextField as ContextField
      );
      button.setAttribute("aria-checked", String(selected));
      const check = button.querySelector<HTMLElement>(".option-check");
      if (check) {
        check.textContent = selected ? "✓" : "";
      }
    });
    locationFormatButtons.forEach((button) => {
      const selected =
        button.dataset.locationFormat === currentSettings.locationFormat;
      button.setAttribute("aria-checked", String(selected));
      const check = button.querySelector<HTMLElement>(".option-check");
      if (check) {
        check.textContent = selected ? "✓" : "";
      }
    });
    applyColorPreset(host, currentSettings.colorPreset);
    updateButtonAvailability();
    updateDisclosure();
  };

  const requestSettingsChange = (nextSettings: LocatorSettings) => {
    if (settingsWritePending) {
      return;
    }
    const previousSettings = currentSettings;
    currentSettings = {
      ...nextSettings,
      contextFields: [...nextSettings.contextFields]
    };
    settingsWritePending = true;
    updateSelectedSettings();
    void options
      .onSettingsChange(nextSettings)
      .then((acceptedSettings) => {
        if (acceptedSettings) {
          currentSettings = {
            ...acceptedSettings,
            contextFields: [...acceptedSettings.contextFields]
          };
        } else {
          currentSettings = previousSettings;
        }
      })
      .catch(() => {
        currentSettings = previousSettings;
      })
      .finally(() => {
        settingsWritePending = false;
        updateSelectedSettings();
      });
  };

  const orderedContextFields = (
    fields: ReadonlySet<ContextField>
  ): ContextField[] =>
    (["tag", "location", "line"] as const).filter((field) =>
      fields.has(field)
    );

  copyModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const copyMode = button.dataset.copyMode as CopyMode;
      if (copyMode === "context") {
        if (currentSettings.copyMode !== "context") {
          contextExpanded = true;
          if (currentSettings.contextFields.length > 0) {
            requestSettingsChange({
              ...currentSettings,
              copyMode: "context"
            });
          } else {
            updateDisclosure();
          }
          return;
        }
        contextExpanded = !contextExpanded;
        updateDisclosure();
        return;
      }
      if (copyMode === "hash") {
        if (currentSettings.copyMode !== "hash") {
          requestSettingsChange({
            ...currentSettings,
            copyMode: "hash"
          });
        }
        return;
      }
    });
  });

  contextFieldButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.dataset.contextField as ContextField;
      const fields = new Set(currentSettings.contextFields);
      if (field === "location") {
        if (fields.has("location")) {
          fields.delete("location");
          fields.delete("line");
        } else {
          fields.add("location");
        }
      } else if (field === "line") {
        if (!fields.has("location")) {
          return;
        }
        if (fields.has("line")) {
          fields.delete("line");
        } else {
          fields.add("line");
        }
      } else if (field === "tag") {
        if (fields.has("tag")) {
          fields.delete("tag");
        } else {
          fields.add("tag");
        }
      } else {
        return;
      }
      const contextFields = orderedContextFields(fields);
      requestSettingsChange({
        ...currentSettings,
        copyMode: contextFields.length > 0 ? "context" : "hash",
        contextFields
      });
    });
  });

  locationFormatButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const locationFormat = button.dataset
        .locationFormat as LocationFormat;
      if (
        !currentSettings.contextFields.includes("location") ||
        (locationFormat !== "path" &&
          locationFormat !== "moduleName") ||
        (locationFormat === currentSettings.locationFormat &&
          currentSettings.copyMode === "context")
      ) {
        return;
      }
      requestSettingsChange({
        ...currentSettings,
        copyMode: "context",
        locationFormat
      });
    });
  });

  choiceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const triggerKey = button.dataset.triggerKey;
      if (
        !TRIGGER_KEYS.includes(triggerKey as TriggerKey) ||
        triggerKey === currentSettings.triggerKey
      ) {
        return;
      }
      requestSettingsChange({
        ...currentSettings,
        triggerKey: triggerKey as TriggerKey
      });
    });
  });

  colorButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const colorPreset = button.dataset.colorPreset;
      if (
        !COLOR_PRESETS.includes(colorPreset as ColorPreset) ||
        colorPreset === currentSettings.colorPreset
      ) {
        return;
      }
      requestSettingsChange({
        ...currentSettings,
        colorPreset: colorPreset as ColorPreset
      });
    });
  });

  parentLevelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const parentLevels = Number(button.dataset.parentLevel);
      if (
        !PARENT_LEVELS.includes(parentLevels as ParentLevels) ||
        parentLevels === currentSettings.parentLevels
      ) {
        return;
      }
      requestSettingsChange({
        ...currentSettings,
        parentLevels: parentLevels as ParentLevels
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

  const copyMcpButton = shadow.querySelector<HTMLButtonElement>(
    "[data-ui-copy-mcp]"
  );
  const quitButton = shadow.querySelector<HTMLButtonElement>("[data-ui-quit]");
  const hideButton = shadow.querySelector<HTMLButtonElement>("[data-ui-hide]");
  if (!copyMcpButton || !quitButton || !hideButton) {
    throw new Error("Locator settings panel could not initialize");
  }

  let copyLabelTimer = 0;
  copyMcpButton.addEventListener("click", () => {
    void options.onCopyMcpPrompt().then((copied) => {
      if (!copied) {
        return;
      }
      window.clearTimeout(copyLabelTimer);
      copyMcpButton.textContent = "Copied ✓";
      copyLabelTimer = window.setTimeout(() => {
        copyMcpButton.textContent = "Copy MCP Prompt";
      }, COPY_FEEDBACK_MS);
    });
  });

  quitButton.addEventListener("click", () => {
    setOpen(false);
    void options.onQuit();
  });

  hideButton.addEventListener("click", () => {
    setOpen(false);
    options.onHide();
  });

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
  updateSelectedSettings();

  return {
    setSettings(settings) {
      currentSettings = settings;
      updateSelectedSettings();
    },
    destroy() {
      window.clearTimeout(copyLabelTimer);
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
