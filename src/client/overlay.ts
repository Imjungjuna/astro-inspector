import {
  SOURCE_FILE_ATTRIBUTE,
  SOURCE_LOCATION_ATTRIBUTE,
  SOURCE_TAG_ATTRIBUTE
} from "../shared/contracts.js";

const INSPECTION_STYLE = `
html[data-astro-ai-locator-active] [${SOURCE_FILE_ATTRIBUTE}][${SOURCE_LOCATION_ATTRIBUTE}]::before,
html[data-astro-ai-locator-active] [${SOURCE_FILE_ATTRIBUTE}][${SOURCE_LOCATION_ATTRIBUTE}]::after {
  pointer-events: none !important;
}
`;

const SOURCE_SELECTOR =
  `[${SOURCE_FILE_ATTRIBUTE}][${SOURCE_LOCATION_ATTRIBUTE}]`;

const BOUNDARY_STYLE = `
html[data-astro-ai-locator-active] ${SOURCE_SELECTOR} {
  outline: 1px dashed rgba(107, 114, 128, 0.18) !important;
  outline-offset: -1px !important;
  cursor: crosshair !important;
}
`;

export interface LocatorOverlay {
  show(target: Element): void;
  hide(): void;
  toast(message: string): void;
  destroy(): void;
}

export function createOverlay(showAllBoundaries: boolean): LocatorOverlay {
  const globalStyle = document.createElement("style");
  globalStyle.dataset.astroAiLocatorStyle = "";
  globalStyle.textContent =
    INSPECTION_STYLE + (showAllBoundaries ? BOUNDARY_STYLE : "");
  document.head.append(globalStyle);

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
        outline: 2px solid rgba(139, 92, 246, 0.4);
        outline-offset: 2px;
        background: transparent;
      }
      .box {
        border: 2px solid rgba(139, 92, 246, 0.85);
        background: rgba(139, 92, 246, 0.1);
      }
      .label {
        position: absolute;
        left: -2px;
        bottom: 100%;
        max-width: min(640px, 90vw);
        padding: 3px 6px;
        overflow: hidden;
        color: white;
        background: #6d28d9;
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
    <div class="parent-box"></div>
    <div class="box"><span class="label"><span class="label-tag"></span><span class="label-separator" aria-hidden="true">│</span><span class="label-file"></span><span class="label-separator" aria-hidden="true">│</span><span class="label-location"></span></span></div>
  `;
  document.documentElement.append(host);

  const toast = document.createElement("div");
  toast.dataset.astroAiLocatorToast = "";
  toast.style.cssText =
    "position:fixed;right:16px;bottom:16px;display:none;z-index:2147483647;padding:8px 12px;border-radius:6px;background:#111827;color:white;font:12px/1.4 ui-sans-serif,sans-serif;pointer-events:none;";
  document.documentElement.append(toast);

  const parentBox = shadow.querySelector<HTMLElement>(".parent-box");
  const box = shadow.querySelector<HTMLElement>(".box");
  const label = shadow.querySelector<HTMLElement>(".label");
  const labelTag = shadow.querySelector<HTMLElement>(".label-tag");
  const labelFile = shadow.querySelector<HTMLElement>(".label-file");
  const labelLocation =
    shadow.querySelector<HTMLElement>(".label-location");
  if (
    !parentBox ||
    !box ||
    !label ||
    !labelTag ||
    !labelFile ||
    !labelLocation
  ) {
    throw new Error("Locator overlay could not initialize");
  }
  let toastTimer = 0;

  return {
    show(target) {
      const rect = target.getBoundingClientRect();
      const parentTarget =
        target.parentElement?.closest(SOURCE_SELECTOR) ?? null;
      const file = target.getAttribute(SOURCE_FILE_ATTRIBUTE) ?? "unknown";
      const location =
        target.getAttribute(SOURCE_LOCATION_ATTRIBUTE) ?? "unknown";
      const domTag = target.localName.toLowerCase();
      const sourceTag = target.getAttribute(SOURCE_TAG_ATTRIBUTE) ?? domTag;
      const tagLabel =
        sourceTag === domTag ? sourceTag : `${sourceTag}→${domTag}`;
      const fileName = file.split(/[/\\]/u).at(-1) ?? file;
      host.style.display = "block";
      if (parentTarget) {
        const parentRect = parentTarget.getBoundingClientRect();
        parentBox.style.display = "block";
        parentBox.style.left = `${parentRect.left}px`;
        parentBox.style.top = `${parentRect.top}px`;
        parentBox.style.width = `${parentRect.width}px`;
        parentBox.style.height = `${parentRect.height}px`;
      } else {
        parentBox.style.display = "none";
      }
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      labelTag.textContent = `<${tagLabel}>`;
      labelFile.textContent = fileName;
      labelLocation.textContent = location;
    },
    hide() {
      host.style.display = "none";
    },
    toast(message) {
      window.clearTimeout(toastTimer);
      toast.textContent = message;
      toast.style.display = "block";
      toastTimer = window.setTimeout(() => {
        toast.style.display = "none";
      }, 1800);
    },
    destroy() {
      window.clearTimeout(toastTimer);
      globalStyle.remove();
      host.remove();
      toast.remove();
    }
  };
}
