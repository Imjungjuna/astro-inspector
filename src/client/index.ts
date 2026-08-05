import {
  SOURCE_FILE_ATTRIBUTE,
  SOURCE_LOCATION_ATTRIBUTE,
  SOURCE_TAG_ATTRIBUTE,
  TOKEN_PATTERN,
  type LocatorClientOptions,
  type LocatorSessionState,
  type LocatorSettings,
  type RegisterElementRequest,
  type RegisterElementResponse
} from "../shared/contracts.js";
import { createOverlay } from "./overlay.js";
import {
  loadLocatorSettings,
  saveLocatorSettings
} from "./settings-api.js";
import {
  createSettingsPanel,
  type LocatorSettingsPanel
} from "./settings-panel.js";
import {
  isTriggerKeyEvent,
  isTriggerModifierPressed
} from "./trigger-key.js";
import { formatClipboardPayload } from "./clipboard-payload.js";
import { formatMcpSetupPrompt } from "./mcp-prompt.js";
import { loadSessionState, quitLocatorSession } from "./session-api.js";

declare global {
  interface Window {
    __astroAiLocatorCleanup?: () => void;
    __astroAiLocatorWarnedMissingMetadata?: boolean;
  }
}

const SOURCE_SELECTOR =
  `[${SOURCE_FILE_ATTRIBUTE}][${SOURCE_LOCATION_ATTRIBUTE}]`;

interface HitCandidate {
  element: Element;
  stackIndex: number;
  area: number;
  depth: number;
}

function containsPoint(
  rect: DOMRect,
  clientX: number,
  clientY: number
): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

function getElementDepth(element: Element): number {
  let depth = 0;
  let current = element.parentElement;
  while (current) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function getContainingArea(
  element: Element,
  clientX: number,
  clientY: number
): number | null {
  const containingAreas = Array.from(element.getClientRects())
    .filter((rect) => containsPoint(rect, clientX, clientY))
    .map((rect) => rect.width * rect.height);
  return containingAreas.length > 0 ? Math.min(...containingAreas) : null;
}

/**
 * Finds the most specific annotated source element at a viewport point.
 *
 * The first native candidate whose own rendered box contains the point defines
 * the visible layer. This prevents a smaller element behind a real DOM overlay
 * from winning only because it has less area. A hit caused exclusively by a
 * stretched pseudo-element has no containing box and is skipped.
 *
 * Supplemental candidates restore annotated `pointer-events: none` descendants
 * that the browser intentionally omits from the native hit stack. They may
 * refine the visible layer, but unrelated transparent elements cannot reach
 * through an overlay.
 * An element's own rendered box must contain the point, so a host selected only
 * because its pseudo-element extends elsewhere is not treated as the target.
 */
export function resolveTargetAtPoint(
  clientX: number,
  clientY: number,
  supplementalCandidates: readonly Element[] = []
): Element | null {
  const createCandidate = (
    element: Element,
    stackIndex: number
  ): HitCandidate | null => {
    const area = getContainingArea(element, clientX, clientY);
    if (area === null) {
      return null;
    }
    return {
      element,
      stackIndex,
      area,
      depth: getElementDepth(element)
    };
  };

  const hitStack = document.elementsFromPoint(clientX, clientY);
  let visibleCandidate: HitCandidate | null = null;
  for (const [stackIndex, hit] of hitStack.entries()) {
    const element = hit.matches(SOURCE_SELECTOR)
      ? hit
      : hit.closest(SOURCE_SELECTOR);
    if (!element) {
      return null;
    }
    const candidate = createCandidate(element, stackIndex);
    if (candidate) {
      visibleCandidate = candidate;
      break;
    }
  }
  if (!visibleCandidate) {
    return null;
  }

  const candidates = new Map<Element, HitCandidate>([
    [visibleCandidate.element, visibleCandidate]
  ]);
  supplementalCandidates.forEach((element, index) => {
    if (
      candidates.has(element) ||
      !visibleCandidate.element.contains(element)
    ) {
      return;
    }
    const candidate = createCandidate(element, hitStack.length + index);
    if (candidate) {
      candidates.set(element, candidate);
    }
  });

  return (
    Array.from(candidates.values()).sort(
      (left, right) =>
        left.area - right.area ||
        right.depth - left.depth ||
        left.stackIndex - right.stackIndex
    )[0]?.element ?? null
  );
}

function contextFieldsEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((field, index) => field === right[index])
  );
}

function getSettingsChangeMessage(
  previousSettings: LocatorSettings,
  settings: LocatorSettings
): string | null {
  if (settings.colorPreset !== previousSettings.colorPreset) {
    return `Overlay color changed to ${settings.colorPreset}`;
  }
  if (settings.parentLevels !== previousSettings.parentLevels) {
    return `Parent levels changed to ${settings.parentLevels}`;
  }
  if (settings.triggerKey !== previousSettings.triggerKey) {
    return `Trigger changed to ${settings.triggerKey}`;
  }
  if (settings.copyMode !== previousSettings.copyMode) {
    return `Copy mode changed to ${
      settings.copyMode === "hash" ? "Hash" : "Context"
    }`;
  }
  if (
    !contextFieldsEqual(
      settings.contextFields,
      previousSettings.contextFields
    ) ||
    settings.locationFormat !== previousSettings.locationFormat
  ) {
    return "Copy context updated";
  }
  return null;
}

function collectPointerTransparentCandidates(): Element[] {
  return Array.from(document.querySelectorAll(SOURCE_SELECTOR)).filter(
    (element) =>
      getComputedStyle(element).pointerEvents === "none" ||
      (element instanceof HTMLButtonElement ||
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement) &&
        element.disabled
  );
}

function isLocatorUiEvent(event: Event): boolean {
  return event.composedPath().some(
    (target) =>
      target instanceof HTMLElement &&
      target.hasAttribute("data-astro-ai-locator-ui")
  );
}

function parseTarget(target: Element): RegisterElementRequest | null {
  const sourceFile = target.getAttribute(SOURCE_FILE_ATTRIBUTE);
  const location = target.getAttribute(SOURCE_LOCATION_ATTRIBUTE);
  const domTag = target.localName.toLowerCase();
  const sourceTag = target.getAttribute(SOURCE_TAG_ATTRIBUTE) ?? domTag;
  const match = location?.match(/^(\d+):(\d+)$/u);
  if (!sourceFile || !match) {
    return null;
  }
  return {
    sourceFile,
    line: Number(match[1]),
    column: Number(match[2]),
    sourceTag,
    domTag
  };
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText =
      "position:fixed;left:-9999px;top:-9999px;opacity:0;";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("Clipboard permission was denied");
    }
  }
}

const QUIT_FAREWELL_MS = 1800;

function installReadyLocator(
  options: LocatorClientOptions,
  initialSettings: LocatorSettings,
  sessionState: LocatorSessionState | null,
  requestCleanup: () => void
): () => void {
  const overlay = createOverlay(
    options.showAllBoundaries,
    initialSettings.colorPreset,
    initialSettings.parentLevels
  );
  if (
    !document.querySelector(SOURCE_SELECTOR) &&
    !window.__astroAiLocatorWarnedMissingMetadata
  ) {
    window.__astroAiLocatorWarnedMissingMetadata = true;
    console.warn(
      "astro-inspector: no Astro source metadata was found on this page"
    );
  }

  let activeTarget: Element | null = null;
  let pointerTransparentCandidates: Element[] = [];
  let pointerX = 0;
  let pointerY = 0;
  let currentSettings = initialSettings;
  let triggerKey = initialSettings.triggerKey;
  let selectionInProgress = false;
  let settingsPanel: LocatorSettingsPanel;

  const setActive = (active: boolean) => {
    if (active) {
      document.documentElement.setAttribute(
        "data-astro-ai-locator-active",
        ""
      );
      pointerTransparentCandidates = collectPointerTransparentCandidates();
      activeTarget = resolveTargetAtPoint(
        pointerX,
        pointerY,
        pointerTransparentCandidates
      );
      if (activeTarget) {
        overlay.show(activeTarget);
      }
      return;
    }
    document.documentElement.removeAttribute(
      "data-astro-ai-locator-active"
    );
    activeTarget = null;
    pointerTransparentCandidates = [];
    overlay.hide();
  };

  let quitting = false;
  const quitExtension = async () => {
    if (quitting) {
      return;
    }
    quitting = true;
    let farewell =
      "Locator closed. Restart the dev server to bring it back.";
    try {
      await quitLocatorSession(options);
    } catch {
      farewell = "Locator closed here only. Reload the page to bring it back.";
    }
    overlay.toast(farewell);
    // Let the toast finish before the overlay that renders it is destroyed.
    window.setTimeout(requestCleanup, QUIT_FAREWELL_MS);
  };

  const copyMcpPrompt = async () => {
    if (!sessionState) {
      overlay.toast("Unable to read MCP configuration");
      return false;
    }
    const prompt = formatMcpSetupPrompt(sessionState);
    try {
      await copyText(prompt);
      return true;
    } catch {
      window.prompt("Copy the astro-inspector MCP setup prompt:", prompt);
      overlay.toast("Clipboard was blocked; prompt opened for manual copy");
      return false;
    }
  };

  settingsPanel = createSettingsPanel({
    settings: currentSettings,
    onCopyMcpPrompt: copyMcpPrompt,
    onQuit: quitExtension,
    async onSettingsChange(nextSettings) {
      try {
        const previousSettings = currentSettings;
        const settings = await saveLocatorSettings(options, nextSettings);
        currentSettings = settings;
        triggerKey = settings.triggerKey;
        settingsPanel.setSettings(settings);
        const triggerChanged =
          settings.triggerKey !== previousSettings.triggerKey;
        overlay.setColorPreset(settings.colorPreset);
        overlay.setParentLevels(settings.parentLevels);
        const settingsChangeMessage = getSettingsChangeMessage(
          previousSettings,
          settings
        );
        if (settingsChangeMessage) {
          overlay.toast(settingsChangeMessage);
        }
        if (triggerChanged) {
          setActive(false);
        } else if (activeTarget) {
          overlay.show(activeTarget);
        }
        return settings;
      } catch (error) {
        overlay.toast(
          error instanceof Error
            ? error.message
            : "Unable to update locator settings"
        );
        return null;
      }
    }
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      isTriggerKeyEvent(event, triggerKey) &&
      isTriggerModifierPressed(event, triggerKey)
    ) {
      setActive(true);
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (isTriggerKeyEvent(event, triggerKey)) {
      setActive(false);
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (isLocatorUiEvent(event)) {
      return;
    }
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!isTriggerModifierPressed(event, triggerKey)) {
      if (
        document.documentElement.hasAttribute(
          "data-astro-ai-locator-active"
        )
      ) {
        setActive(false);
      }
      return;
    }
    if (
      !document.documentElement.hasAttribute(
        "data-astro-ai-locator-active"
      )
    ) {
      setActive(true);
    }
    const candidate = resolveTargetAtPoint(
      pointerX,
      pointerY,
      pointerTransparentCandidates
    );
    if (candidate !== activeTarget) {
      activeTarget = candidate ?? null;
      if (activeTarget) {
        overlay.show(activeTarget);
      } else {
        overlay.hide();
      }
    }
  };
  const selectTarget = async (event: MouseEvent) => {
    if (
      !isTriggerModifierPressed(event, triggerKey) ||
      isLocatorUiEvent(event)
    ) {
      return;
    }
    const origin = event.target;
    if (!(origin instanceof Element)) {
      return;
    }
    const target =
      resolveTargetAtPoint(
        event.clientX,
        event.clientY,
        pointerTransparentCandidates
      ) ??
      origin.closest(SOURCE_SELECTOR);
    if (!target) {
      return;
    }
    const input = parseTarget(target);
    if (!input) {
      overlay.toast("Unable to read Astro source metadata");
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (selectionInProgress) {
      return;
    }
    selectionInProgress = true;

    try {
      const response = await fetch(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-astro-ai-locator-token": options.sessionToken
        },
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        throw new Error(`Registration failed with HTTP ${response.status}`);
      }
      const result = (await response.json()) as RegisterElementResponse;
      if (
        !TOKEN_PATTERN.test(result.token) ||
        !result.entry ||
        typeof result.entry.file !== "string" ||
        !Number.isInteger(result.entry.line) ||
        !Number.isInteger(result.entry.column) ||
        typeof result.entry.sourceTag !== "string" ||
        typeof result.entry.domTag !== "string" ||
        typeof result.workspaceFile !== "string" ||
        !result.workspaceFile.startsWith("/") ||
        result.workspaceFile.length < 2
      ) {
        throw new Error("Registration returned invalid locator data");
      }
      target.setAttribute("data-comp-token", result.token);
      const clipboardPayload = formatClipboardPayload(
        result,
        currentSettings
      );
      const copyingContext = currentSettings.copyMode === "context";
      try {
        await copyText(clipboardPayload);
        overlay.toast(
          copyingContext ? "Copied context" : `Copied ${result.token}`
        );
      } catch {
        window.prompt(
          copyingContext
            ? "Copy Astro locator context:"
            : "Copy Astro locator token:",
          clipboardPayload
        );
        overlay.toast(
          `Clipboard was blocked; ${
            copyingContext ? "context" : "token"
          } opened for manual copy`
        );
      }
    } catch (error) {
      overlay.toast(
        error instanceof Error ? error.message : "Unable to copy locator"
      );
    } finally {
      selectionInProgress = false;
      setActive(false);
    }
  };
  const onClick = (event: MouseEvent) => {
    if (event.button === 0) {
      void selectTarget(event);
    }
  };
  const onContextMenu = (event: MouseEvent) => {
    if (triggerKey === "control") {
      void selectTarget(event);
    }
  };
  const onBlur = () => setActive(false);
  const onVisibilityChange = () => {
    if (document.hidden) {
      setActive(false);
    }
  };
  const repositionActiveTarget = () => {
    if (activeTarget) {
      overlay.show(activeTarget);
    }
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("contextmenu", onContextMenu, true);
  window.addEventListener("blur", onBlur);
  window.addEventListener("resize", repositionActiveTarget);
  window.addEventListener("scroll", repositionActiveTarget, true);
  document.addEventListener("visibilitychange", onVisibilityChange);

  const cleanup = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("contextmenu", onContextMenu, true);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("resize", repositionActiveTarget);
    window.removeEventListener("scroll", repositionActiveTarget, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    setActive(false);
    settingsPanel.destroy();
    overlay.destroy();
  };

  return cleanup;
}

export function installLocator(options: LocatorClientOptions): () => void {
  window.__astroAiLocatorCleanup?.();
  let disposed = false;
  let runtimeCleanup: (() => void) | undefined;

  const cleanup = () => {
    disposed = true;
    runtimeCleanup?.();
    document.documentElement.removeAttribute(
      "data-astro-ai-locator-ready"
    );
    if (window.__astroAiLocatorCleanup === cleanup) {
      delete window.__astroAiLocatorCleanup;
    }
  };
  window.__astroAiLocatorCleanup = cleanup;

  void Promise.all([
    loadLocatorSettings(options),
    loadSessionState(options)
  ]).then(([settings, sessionState]) => {
    if (disposed || window.__astroAiLocatorCleanup !== cleanup) {
      return;
    }
    // Quit Extension is per dev server process, so a reload keeps it closed.
    if (sessionState?.disabled) {
      cleanup();
      return;
    }
    runtimeCleanup = installReadyLocator(
      options,
      settings,
      sessionState,
      cleanup
    );
    document.documentElement.setAttribute(
      "data-astro-ai-locator-ready",
      ""
    );
  });

  return cleanup;
}
