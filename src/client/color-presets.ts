import type { ColorPreset } from "../shared/contracts.js";

export interface LocatorColorTheme {
  swatch: string;
  overlayRgb: string;
  solid: string;
  label: string;
}

export const LOCATOR_COLOR_THEMES: Record<
  ColorPreset,
  LocatorColorTheme
> = {
  neutral: {
    swatch: "#111111",
    overlayRgb: "82, 82, 91",
    solid: "#3f3f46",
    label: "#27272a"
  },
  violet: {
    swatch: "#7c3aed",
    overlayRgb: "139, 92, 246",
    solid: "#7c3aed",
    label: "#6d28d9"
  },
  orange: {
    swatch: "#f97316",
    overlayRgb: "251, 146, 60",
    solid: "#ea580c",
    label: "#c2410c"
  },
  sky: {
    swatch: "#0ea5e9",
    overlayRgb: "56, 189, 248",
    solid: "#0284c7",
    label: "#0369a1"
  }
};

export function applyColorPreset(
  element: HTMLElement,
  preset: ColorPreset
): void {
  const theme = LOCATOR_COLOR_THEMES[preset];
  element.style.setProperty("--locator-overlay-rgb", theme.overlayRgb);
  element.style.setProperty("--locator-solid", theme.solid);
  element.style.setProperty("--locator-label", theme.label);
}
