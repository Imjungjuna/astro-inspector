import {
  SOURCE_FILE_ATTRIBUTE,
  SOURCE_LOCATION_ATTRIBUTE,
  SOURCE_TAG_ATTRIBUTE,
  type LocatorClientOptions,
  type RegisterElementRequest,
  type RegisterElementResponse,
  type TriggerKey
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
 * `elementsFromPoint` keeps underlying elements in the candidate stack, which
 * lets the locator see through stretched links and other transparent overlays.
 * Supplemental candidates restore annotated `pointer-events: none` elements
 * that the browser intentionally omits from that native hit stack.
 * An element's own rendered box must contain the point, so a host selected only
 * because its pseudo-element extends elsewhere is not treated as the target.
 */
export function resolveTargetAtPoint(
  clientX: number,
  clientY: number,
  supplementalCandidates: readonly Element[] = []
): Element | null {
  const candidates = new Map<Element, HitCandidate>();
  const addCandidate = (element: Element, stackIndex: number) => {
    if (candidates.has(element)) {
      return;
    }
    const area = getContainingArea(element, clientX, clientY);
    if (area === null) {
      return;
    }
    candidates.set(element, {
      element,
      stackIndex,
      area,
      depth: getElementDepth(element)
    });
  };

  const hitStack = document.elementsFromPoint(clientX, clientY);
  hitStack.forEach((hit, stackIndex) => {
    const element = hit.matches(SOURCE_SELECTOR)
      ? hit
      : hit.closest(SOURCE_SELECTOR);
    if (!element) {
      return;
    }
    addCandidate(element, stackIndex);
  });
  supplementalCandidates.forEach((element, index) => {
    addCandidate(element, hitStack.length + index);
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

function collectPointerTransparentCandidates(): Element[] {
  return Array.from(document.querySelectorAll(SOURCE_SELECTOR)).filter(
    (element) => getComputedStyle(element).pointerEvents === "none"
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

function installReadyLocator(
  options: LocatorClientOptions,
  initialTriggerKey: TriggerKey
): () => void {
  const overlay = createOverlay(options.showAllBoundaries);
  if (
    !document.querySelector(SOURCE_SELECTOR) &&
    !window.__astroAiLocatorWarnedMissingMetadata
  ) {
    window.__astroAiLocatorWarnedMissingMetadata = true;
    console.warn(
      "astro-ai-locator: no Astro source metadata was found on this page"
    );
  }

  let activeTarget: Element | null = null;
  let pointerTransparentCandidates: Element[] = [];
  let pointerX = 0;
  let pointerY = 0;
  let triggerKey = initialTriggerKey;
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

  settingsPanel = createSettingsPanel({
    triggerKey,
    async onTriggerKeyChange(nextTriggerKey) {
      try {
        const settings = await saveLocatorSettings(options, nextTriggerKey);
        triggerKey = settings.triggerKey;
        settingsPanel.setTriggerKey(triggerKey);
        overlay.toast(`Trigger changed to ${triggerKey}`);
        setActive(false);
        return true;
      } catch (error) {
        overlay.toast(
          error instanceof Error
            ? error.message
            : "Unable to update locator trigger"
        );
        return false;
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
      if (!/^astro_hash_[a-f0-9]{24}$/u.test(result.hash)) {
        throw new Error("Registration returned an invalid locator hash");
      }
      target.setAttribute("data-comp-hash", result.hash);
      try {
        await copyText(result.hash);
        overlay.toast(`Copied ${result.hash}`);
      } catch {
        window.prompt("Copy Astro locator hash:", result.hash);
        overlay.toast("Clipboard was blocked; hash opened for manual copy");
      }
    } catch (error) {
      overlay.toast(
        error instanceof Error ? error.message : "Unable to copy locator hash"
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

  void loadLocatorSettings(options).then((settings) => {
    if (disposed || window.__astroAiLocatorCleanup !== cleanup) {
      return;
    }
    runtimeCleanup = installReadyLocator(options, settings.triggerKey);
    document.documentElement.setAttribute(
      "data-astro-ai-locator-ready",
      ""
    );
  });

  return cleanup;
}
