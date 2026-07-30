import {
  SOURCE_FILE_ATTRIBUTE,
  SOURCE_LOCATION_ATTRIBUTE,
  SOURCE_TAG_ATTRIBUTE,
  type ColorPreset,
  type ParentLevels
} from "../shared/contracts.js";
import { applyColorPreset } from "./color-presets.js";

const INSPECTION_STYLE = `
html[data-astro-ai-locator-active] [${SOURCE_FILE_ATTRIBUTE}][${SOURCE_LOCATION_ATTRIBUTE}]::before,
html[data-astro-ai-locator-active] [${SOURCE_FILE_ATTRIBUTE}][${SOURCE_LOCATION_ATTRIBUTE}]::after {
  pointer-events: none !important;
}
`;

const SOURCE_SELECTOR =
  `[${SOURCE_FILE_ATTRIBUTE}][${SOURCE_LOCATION_ATTRIBUTE}]`;
const RECT_TOLERANCE = 0.5;
const LABEL_VIEWPORT_GAP = 8;

const BOUNDARY_STYLE = `
html[data-astro-ai-locator-active] ${SOURCE_SELECTOR} {
  outline: 1px dashed rgba(107, 114, 128, 0.18) !important;
  outline-offset: -1px !important;
  cursor: crosshair !important;
}
`;

const TOAST_STYLE = `
[data-astro-ai-locator-toast] {
  position: fixed;
  left: 50%;
  bottom: calc(20px + env(safe-area-inset-bottom));
  z-index: 2147483647;
  box-sizing: border-box;
  min-height: 44px;
  max-width: min(420px, calc((100vw - 32px) / 1.04));
  padding: 12px 16px;
  overflow: hidden;
  border-radius: 10px;
  background: rgba(17, 24, 39, 0.94);
  color: white;
  font: 500 14px/20px ui-sans-serif, system-ui, sans-serif;
  opacity: 0;
  pointer-events: none;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  visibility: hidden;
  white-space: nowrap;
}
[data-astro-ai-locator-toast][data-visible] {
  animation: astro-ai-locator-toast-pop 1800ms both;
  visibility: visible;
}
@keyframes astro-ai-locator-toast-pop {
  0% {
    opacity: 0;
    transform: translate(-50%, 12px) scale(0.92);
  }
  7% {
    opacity: 1;
    transform: translate(-50%, 0) scale(1.04);
  }
  12.2%, 82% {
    opacity: 1;
    transform: translate(-50%, 0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, 4px) scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-astro-ai-locator-toast][data-visible] {
    animation-name: astro-ai-locator-toast-fade;
  }
  @keyframes astro-ai-locator-toast-fade {
    0%, 100% { opacity: 0; }
    8%, 82% { opacity: 1; }
  }
}
`;

export interface LocatorOverlay {
  show(target: Element): void;
  hide(): void;
  toast(message: string): void;
  setColorPreset(colorPreset: ColorPreset): void;
  setParentLevels(parentLevels: ParentLevels): void;
  destroy(): void;
}

function hasVisibleRect(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

function hasMatchingRect(rect: DOMRect, accepted: DOMRect[]): boolean {
  return accepted.some(
    (candidate) =>
      Math.abs(candidate.left - rect.left) <= RECT_TOLERANCE &&
      Math.abs(candidate.top - rect.top) <= RECT_TOLERANCE &&
      Math.abs(candidate.width - rect.width) <= RECT_TOLERANCE &&
      Math.abs(candidate.height - rect.height) <= RECT_TOLERANCE
  );
}

function collectParentRects(
  target: Element,
  limit: ParentLevels
): DOMRect[] {
  const accepted: DOMRect[] = [];
  let ancestor = target.parentElement;
  while (ancestor && accepted.length < limit) {
    if (ancestor.matches(SOURCE_SELECTOR)) {
      const rect = ancestor.getBoundingClientRect();
      if (hasVisibleRect(rect) && !hasMatchingRect(rect, accepted)) {
        accepted.push(rect);
      }
    }
    ancestor = ancestor.parentElement;
  }
  return accepted;
}

function positionBox(box: HTMLElement, rect: DOMRect): void {
  box.style.display = "block";
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
}

export function createOverlay(
  showAllBoundaries: boolean,
  colorPreset: ColorPreset,
  parentLevels: ParentLevels
): LocatorOverlay {
  const globalStyle = document.createElement("style");
  globalStyle.dataset.astroAiLocatorStyle = "";
  globalStyle.textContent =
    INSPECTION_STYLE + (showAllBoundaries ? BOUNDARY_STYLE : "");
  document.head.append(globalStyle);

  const toastStyle = document.createElement("style");
  toastStyle.dataset.astroAiLocatorToastStyle = "";
  toastStyle.textContent = TOAST_STYLE;
  document.head.append(toastStyle);

  const host = document.createElement("div");
  host.dataset.astroAiLocatorOverlay = "";
  host.style.cssText =
    "position:fixed;inset:0;display:none;pointer-events:none;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .parent-box,
      .box {
        position: fixed;
        box-sizing: border-box;
        pointer-events: none;
      }
      .parent-box {
        display: none;
        border: 0;
        outline: 2px solid transparent;
        outline-offset: 2px;
        background: transparent;
      }
      .parent-box[data-parent-level="1"] {
        outline-color: rgba(var(--locator-overlay-rgb), 0.7);
      }
      .parent-box[data-parent-level="2"] {
        outline-color: rgba(var(--locator-overlay-rgb), 0.6);
      }
      .parent-box[data-parent-level="3"] {
        outline-color: rgba(var(--locator-overlay-rgb), 0.45);
      }
      .box {
        border: 2px solid rgba(var(--locator-overlay-rgb), 0.9);
        background: rgba(var(--locator-overlay-rgb), 0.1);
      }
      .label {
        position: fixed;
        display: none;
        box-sizing: border-box;
        max-width: min(640px, 90vw, calc(100vw - 16px));
        padding: 3px 6px;
        overflow: hidden;
        color: white;
        background: var(--locator-label);
        border-radius: 4px 4px 0 0;
        font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .label-tag {
        font-weight: 700;
        opacity: 1;
      }
      .label-file {
        font-weight: 500;
        opacity: 0.9;
      }
      .label-location {
        font-weight: 400;
        opacity: 0.75;
      }
      .label-separator {
        font-weight: 400;
        margin-inline: 4px;
        opacity: 0.48;
      }
    </style>
    <div class="parent-box" data-parent-level="1"></div>
    <div class="parent-box" data-parent-level="2"></div>
    <div class="parent-box" data-parent-level="3"></div>
    <div class="box"></div>
    <span class="label"><span class="label-tag"></span><span class="label-separator" aria-hidden="true">│</span><span class="label-file"></span><span class="label-separator" aria-hidden="true">│</span><span class="label-location"></span></span>
  `;
  applyColorPreset(host, colorPreset);
  document.documentElement.append(host);

  const toast = document.createElement("div");
  toast.dataset.astroAiLocatorToast = "";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.documentElement.append(toast);

  const parentBoxes = Array.from(
    shadow.querySelectorAll<HTMLElement>(".parent-box")
  );
  const box = shadow.querySelector<HTMLElement>(".box");
  const label = shadow.querySelector<HTMLElement>(".label");
  const labelTag = shadow.querySelector<HTMLElement>(".label-tag");
  const labelFile = shadow.querySelector<HTMLElement>(".label-file");
  const labelLocation =
    shadow.querySelector<HTMLElement>(".label-location");
  if (
    parentBoxes.length !== 3 ||
    !box ||
    !label ||
    !labelTag ||
    !labelFile ||
    !labelLocation
  ) {
    throw new Error("Locator overlay could not initialize");
  }
  let toastTimer = 0;
  let currentParentLevels = parentLevels;

  return {
    show(target) {
      const rect = target.getBoundingClientRect();
      const parentRects = collectParentRects(
        target,
        currentParentLevels
      );
      const file = target.getAttribute(SOURCE_FILE_ATTRIBUTE) ?? "unknown";
      const location =
        target.getAttribute(SOURCE_LOCATION_ATTRIBUTE) ?? "unknown";
      const domTag = target.localName.toLowerCase();
      const sourceTag = target.getAttribute(SOURCE_TAG_ATTRIBUTE) ?? domTag;
      const tagLabel =
        sourceTag === domTag ? sourceTag : `${sourceTag}→${domTag}`;
      const fileName = file.split(/[/\\]/u).at(-1) ?? file;
      host.style.display = "block";
      parentBoxes.forEach((parentBox, index) => {
        const parentRect = parentRects[index];
        if (parentRect) {
          positionBox(parentBox, parentRect);
        } else {
          parentBox.style.display = "none";
        }
      });
      positionBox(box, rect);
      labelTag.textContent = `<${tagLabel}>`;
      labelFile.textContent = fileName;
      labelLocation.textContent = location;
      label.style.display = "block";
      const labelRect = label.getBoundingClientRect();
      const spaceAbove = rect.top - LABEL_VIEWPORT_GAP;
      const spaceBelow =
        window.innerHeight - LABEL_VIEWPORT_GAP - rect.bottom;
      const placement =
        spaceAbove >= labelRect.height
          ? "above"
          : spaceBelow >= labelRect.height
            ? "below"
            : spaceAbove >= spaceBelow
              ? "above"
              : "below";
      const desiredTop =
        placement === "above"
          ? rect.top - labelRect.height
          : rect.bottom;
      const maxTop = Math.max(
        LABEL_VIEWPORT_GAP,
        window.innerHeight - LABEL_VIEWPORT_GAP - labelRect.height
      );
      const maxLeft = Math.max(
        LABEL_VIEWPORT_GAP,
        window.innerWidth - LABEL_VIEWPORT_GAP - labelRect.width
      );
      label.style.left = `${Math.min(
        Math.max(rect.left, LABEL_VIEWPORT_GAP),
        maxLeft
      )}px`;
      label.style.top = `${Math.min(
        Math.max(desiredTop, LABEL_VIEWPORT_GAP),
        maxTop
      )}px`;
      label.dataset.placement = placement;
    },
    hide() {
      host.style.display = "none";
    },
    toast(message) {
      window.clearTimeout(toastTimer);
      toast.removeAttribute("data-visible");
      toast.getAnimations().forEach((animation) => animation.cancel());
      void toast.offsetWidth;
      toast.textContent = message;
      toast.setAttribute("data-visible", "");
      toastTimer = window.setTimeout(() => {
        toast.removeAttribute("data-visible");
      }, 1800);
    },
    setColorPreset(nextColorPreset) {
      applyColorPreset(host, nextColorPreset);
    },
    setParentLevels(nextParentLevels) {
      currentParentLevels = nextParentLevels;
      parentBoxes.forEach((parentBox, index) => {
        if (index >= nextParentLevels) {
          parentBox.style.display = "none";
        }
      });
    },
    destroy() {
      window.clearTimeout(toastTimer);
      globalStyle.remove();
      toastStyle.remove();
      host.remove();
      toast.remove();
    }
  };
}
