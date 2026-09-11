/** Semantic color customization (#246).
 *
 * Opens the *values* of the `--ui-*` semantic color contract while keeping the
 * names and purposes stable. Three entry points (built-in presets, the color
 * picker in settings, and — in a follow-up — constrained Agent generation) all
 * edit the same `ThemeCustomization` record; this module is the single
 * resolution path:
 *
 *   preset + user overrides -> sanitize -> effective palette
 *     -> inline `--ui-*` custom properties (custom components / antd-skin.css)
 *     -> antd token derivation (ConfigProvider in App.tsx)
 *
 * Persistence is `localStorage`, matching theme-mode.ts: the preload bridge is
 * a whitelisted control-plane surface and a display preference does not
 * justify widening it. Stored data is always sanitized on read, so a corrupt
 * or hostile value can never reach the DOM — unknown keys and non-color
 * literals are dropped, and an unreadable record degrades to the default.
 *
 * The `roleweave` preset mirrors antd-skin.css exactly; when it is active
 * with no overrides nothing is written inline, so the stylesheet stays the
 * source of truth and default users see zero change.
 */

import { useEffect, useState } from "react";
import type { ThemeMode } from "./theme-mode";

/** The open semantic color contract: every key maps 1:1 to a `--ui-*` custom
 * property shipped in antd-skin.css. Radius, shadow, font and motion tokens
 * are deliberately not color-personalizable in this revision. */
export const SEMANTIC_COLOR_KEYS = [
  "canvas",
  "canvas-subtle",
  "navigation",
  "navigation-hover",
  "surface",
  "surface-raised",
  "surface-inset",
  "foreground",
  "foreground-muted",
  "foreground-subtle",
  "border",
  "border-strong",
  "primary",
  "primary-hover",
  "primary-foreground",
  "primary-soft",
  "brand",
  "brand-soft",
  "brand-blue",
  "ai",
  "ai-strong",
  "ai-hover",
  "ai-foreground",
  "ai-soft",
  "info",
  "info-soft",
  "success",
  "success-strong",
  "success-soft",
  "success-foreground",
  "warning",
  "warning-strong",
  "warning-soft",
  "warning-foreground",
  "danger",
  "danger-strong",
  "danger-soft",
  "danger-foreground",
  "overlay",
  "focus",
  "selection",
] as const;

export type SemanticColorKey = (typeof SEMANTIC_COLOR_KEYS)[number];
export type FullPalette = Record<SemanticColorKey, string>;
export type PartialPalette = Partial<Record<SemanticColorKey, string>>;

export const THEME_PRESET_IDS = ["roleweave", "antd"] as const;
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

export interface ThemeCustomization {
  preset: ThemePresetId;
  /** Per-mode user edits on top of the preset. Kept per mode so editing the
   * dark palette never touches light and vice versa (#246 REQ-01). */
  overrides: { light: PartialPalette; dark: PartialPalette };
}

export const THEME_CUSTOM_STORAGE_KEY = "owb.theme-custom";

/** Fired on window after every accepted write so React readers re-render. */
export const THEME_CUSTOM_EVENT = "owb-theme-custom-changed";

/** Built-in presets (#246 REQ-02). `roleweave` reproduces antd-skin.css
 * token-for-token; `antd` is the Ant Design v6 default palette (light/dark
 * algorithm outputs), with soft/strong steps taken from AntD's generated
 * color ramps. */
export const THEME_PRESETS: Record<ThemePresetId, { light: FullPalette; dark: FullPalette }> = {
  roleweave: {
    light: {
      "canvas": "#f7f8fb",
      "canvas-subtle": "#f1f3f7",
      "navigation": "#f1f3f7",
      "navigation-hover": "#e8ebf2",
      "surface": "#ffffff",
      "surface-raised": "#ffffff",
      "surface-inset": "#f4f5f8",
      "foreground": "#242630",
      "foreground-muted": "#596172",
      "foreground-subtle": "#606a7b",
      "border": "#e2e5ed",
      "border-strong": "#c7cedb",
      "primary": "#3e63dd",
      "primary-hover": "#3153c4",
      "primary-foreground": "#ffffff",
      "primary-soft": "#edf1ff",
      "brand": "#732fd1",
      "brand-soft": "#f3edfc",
      "brand-blue": "#5179ff",
      "ai": "#732fd1",
      "ai-strong": "#6124b8",
      "ai-hover": "#6124b8",
      "ai-foreground": "#ffffff",
      "ai-soft": "#f3edfc",
      "info": "#3e63dd",
      "info-soft": "#edf1ff",
      "success": "#2e7052",
      "success-strong": "#24573f",
      "success-soft": "#edf7f1",
      "success-foreground": "#ffffff",
      "warning": "#8a5a12",
      "warning-strong": "#75480b",
      "warning-soft": "#fff5e4",
      "warning-foreground": "#ffffff",
      "danger": "#b83d3d",
      "danger-strong": "#a22f36",
      "danger-soft": "#fff0f0",
      "danger-foreground": "#ffffff",
      "overlay": "rgba(20, 21, 27, 0.35)",
      "focus": "#732fd1",
      "selection": "#f3edfc",
    },
    dark: {
      "canvas": "#14151b",
      "canvas-subtle": "#181a20",
      "navigation": "#181a20",
      "navigation-hover": "#252831",
      "surface": "#1c1e25",
      "surface-raised": "#252831",
      "surface-inset": "#171920",
      "foreground": "#e5e7ed",
      "foreground-muted": "#b1b7c5",
      "foreground-subtle": "#969eaf",
      "border": "#343844",
      "border-strong": "#4b5262",
      "primary": "#86a0ff",
      "primary-hover": "#a0b4ff",
      "primary-foreground": "#14151b",
      "primary-soft": "#252e49",
      "brand": "#bb93f6",
      "brand-soft": "#30233f",
      "brand-blue": "#86a0ff",
      "ai": "#bb93f6",
      "ai-strong": "#cdaeff",
      "ai-hover": "#cdaeff",
      "ai-foreground": "#1b1526",
      "ai-soft": "#30233f",
      "info": "#86a0ff",
      "info-soft": "#252e49",
      "success": "#84c7a3",
      "success-strong": "#a2dabb",
      "success-soft": "#20372c",
      "success-foreground": "#14151b",
      "warning": "#ddb35d",
      "warning-strong": "#efcc86",
      "warning-soft": "#352e20",
      "warning-foreground": "#14151b",
      "danger": "#ef9699",
      "danger-strong": "#ffb1b4",
      "danger-soft": "#3a242b",
      "danger-foreground": "#14151b",
      "overlay": "rgba(0, 0, 0, 0.65)",
      "focus": "#bb93f6",
      "selection": "#30233f",
    },
  },
  antd: {
    light: {
      "canvas": "#f5f5f5",
      "canvas-subtle": "#fafafa",
      "navigation": "#fafafa",
      "navigation-hover": "#f0f0f0",
      "surface": "#ffffff",
      "surface-raised": "#ffffff",
      "surface-inset": "#fafafa",
      "foreground": "rgba(0, 0, 0, 0.88)",
      "foreground-muted": "rgba(0, 0, 0, 0.65)",
      "foreground-subtle": "rgba(0, 0, 0, 0.45)",
      "border": "#d9d9d9",
      "border-strong": "#bfbfbf",
      "primary": "#1677ff",
      "primary-hover": "#4096ff",
      "primary-foreground": "#ffffff",
      "primary-soft": "#e6f4ff",
      "brand": "#1677ff",
      "brand-soft": "#e6f4ff",
      "brand-blue": "#1677ff",
      "ai": "#722ed1",
      "ai-strong": "#531dab",
      "ai-hover": "#531dab",
      "ai-foreground": "#ffffff",
      "ai-soft": "#f9f0ff",
      "info": "#1677ff",
      "info-soft": "#e6f4ff",
      "success": "#52c41a",
      "success-strong": "#389e0d",
      "success-soft": "#f6ffed",
      "success-foreground": "#ffffff",
      "warning": "#faad14",
      "warning-strong": "#d48806",
      "warning-soft": "#fffbe6",
      "warning-foreground": "#ffffff",
      "danger": "#ff4d4f",
      "danger-strong": "#d9363e",
      "danger-soft": "#fff2f0",
      "danger-foreground": "#ffffff",
      "overlay": "rgba(0, 0, 0, 0.45)",
      "focus": "#1677ff",
      "selection": "#e6f4ff",
    },
    dark: {
      "canvas": "#000000",
      "canvas-subtle": "#141414",
      "navigation": "#141414",
      "navigation-hover": "#1f1f1f",
      "surface": "#141414",
      "surface-raised": "#1f1f1f",
      "surface-inset": "#1d1d1d",
      "foreground": "rgba(255, 255, 255, 0.85)",
      "foreground-muted": "rgba(255, 255, 255, 0.65)",
      "foreground-subtle": "rgba(255, 255, 255, 0.45)",
      "border": "#424242",
      "border-strong": "#5a5a5a",
      "primary": "#1668dc",
      "primary-hover": "#3c89e8",
      "primary-foreground": "#ffffff",
      "primary-soft": "#111a2c",
      "brand": "#1668dc",
      "brand-soft": "#111a2c",
      "brand-blue": "#1668dc",
      "ai": "#642ab5",
      "ai-strong": "#854ed8",
      "ai-hover": "#854ed8",
      "ai-foreground": "#ffffff",
      "ai-soft": "#1a1325",
      "info": "#1668dc",
      "info-soft": "#111a2c",
      "success": "#49aa19",
      "success-strong": "#6abe39",
      "success-soft": "#162312",
      "success-foreground": "#141414",
      "warning": "#d89614",
      "warning-strong": "#e8b339",
      "warning-soft": "#2b2111",
      "warning-foreground": "#141414",
      "danger": "#dc4446",
      "danger-strong": "#e86e6b",
      "danger-soft": "#2c1618",
      "danger-foreground": "#141414",
      "overlay": "rgba(0, 0, 0, 0.65)",
      "focus": "#1668dc",
      "selection": "#111a2c",
    },
  },
};

export const DEFAULT_CUSTOMIZATION: ThemeCustomization = {
  preset: "roleweave",
  overrides: { light: {}, dark: {} },
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const HEX_SHORT_RE = /^#[0-9a-fA-F]{3}$/;
const RGBA_RE = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/;
const RGB_RE = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/;

/** Whitelisted color literals only (#246 REQ-05): hex, rgb(), rgba(). No
 * url(), var(), calc(), or anything else a stylesheet could interpret. */
export function isValidColorLiteral(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (HEX_RE.test(v) || HEX_SHORT_RE.test(v)) return true;
  const m = v.match(RGBA_RE) ?? v.match(RGB_RE);
  if (m === null) return false;
  return m.slice(1, 4).every((channel) => Number(channel) <= 255);
}

function isSemanticKey(key: unknown): key is SemanticColorKey {
  return typeof key === "string" && (SEMANTIC_COLOR_KEYS as readonly string[]).includes(key);
}

function isPresetId(value: unknown): value is ThemePresetId {
  return typeof value === "string" && (THEME_PRESET_IDS as readonly string[]).includes(value);
}

/** Drop unknown keys and invalid values; keep whatever survives. */
export function sanitizePalette(raw: unknown): PartialPalette {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: PartialPalette = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isSemanticKey(key) && isValidColorLiteral(value)) out[key] = value.trim();
  }
  return out;
}

/** Parse and sanitize a full stored record. Anything unrecognized degrades
 * field-by-field to the default rather than throwing at boot. */
export function sanitizeCustomization(raw: unknown): ThemeCustomization {
  const fallback = { ...DEFAULT_CUSTOMIZATION, overrides: { light: {}, dark: {} } };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const record = raw as Record<string, unknown>;
  const overrides = (record.overrides ?? {}) as Record<string, unknown>;
  return {
    preset: isPresetId(record.preset) ? record.preset : "roleweave",
    overrides: {
      light: sanitizePalette(overrides.light),
      dark: sanitizePalette(overrides.dark),
    },
  };
}

/** The preset merged with the user's per-mode overrides. */
export function effectivePalette(custom: ThemeCustomization, mode: ThemeMode): FullPalette {
  return { ...THEME_PRESETS[custom.preset][mode], ...custom.overrides[mode] };
}

export function isDefaultCustomization(custom: ThemeCustomization): boolean {
  return (
    custom.preset === "roleweave" &&
    Object.keys(custom.overrides.light).length === 0 &&
    Object.keys(custom.overrides.dark).length === 0
  );
}

/** Stored customization, always sanitized. Storage can throw (site data
 * disabled, hardened profiles); failure degrades to the default. */
export function readStoredCustomization(): ThemeCustomization {
  try {
    const raw = window.localStorage.getItem(THEME_CUSTOM_STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_CUSTOMIZATION, overrides: { light: {}, dark: {} } };
    return sanitizeCustomization(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CUSTOMIZATION, overrides: { light: {}, dark: {} } };
  }
}

function notifyChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(THEME_CUSTOM_EVENT));
  } catch {
    // Environments without CustomEvent still keep in-memory state coherent;
    // only cross-component notification is lost.
  }
}

/** Persist a customization and re-apply it. The write is validated by
 * round-tripping through the sanitizer first, so a caller cannot smuggle an
 * unwhitelisted key or value into storage via this entry point. */
export function storeCustomization(next: ThemeCustomization): void {
  const clean = sanitizeCustomization(next);
  try {
    window.localStorage.setItem(THEME_CUSTOM_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Read-only storage: the session still switches, the choice just does
    // not survive a restart. Matches theme-mode.ts behaviour.
  }
  applyCustomizationVars(currentMode());
  notifyChanged();
}

/** Remove the stored customization and the inline variables. */
export function clearStoredCustomization(): void {
  try {
    window.localStorage.removeItem(THEME_CUSTOM_STORAGE_KEY);
  } catch {
    // Nothing sensible to do; the inline vars are cleared below regardless.
  }
  clearCustomizationVars();
  notifyChanged();
}

function currentMode(): ThemeMode {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/** True when the inline layer is needed at all. The default stays on the
 * stylesheet alone so antd-skin.css remains the source of truth for it. */
function needsInlineLayer(custom: ThemeCustomization): boolean {
  return !isDefaultCustomization(custom);
}

/** Stamp the effective palette as inline `--ui-*` custom properties on
 * `<html>`. Inline wins over the `:root` / `[data-theme]` stylesheet rules
 * (none of which use !important), and only for keys that actually differ
 * from nothing: every key is written so a preset switch replaces the whole
 * previous set. */
export function applyCustomizationVars(mode: ThemeMode): void {
  const custom = readStoredCustomization();
  const root = document.documentElement;
  if (!needsInlineLayer(custom)) {
    clearCustomizationVars();
    return;
  }
  const palette = effectivePalette(custom, mode);
  for (const key of SEMANTIC_COLOR_KEYS) {
    root.style.setProperty(`--ui-${key}`, palette[key]);
  }
}

/** Remove every inline `--ui-*` override so the stylesheet applies again. */
export function clearCustomizationVars(): void {
  const root = document.documentElement;
  for (const key of SEMANTIC_COLOR_KEYS) {
    root.style.removeProperty(`--ui-${key}`);
  }
}

/** Boot seed, called next to initThemeMode() before createRoot(). Also
 * watches `data-theme` so a light/dark switch re-resolves the per-mode
 * palette — theme-mode.ts stays the only writer of the attribute. Returns a
 * teardown for the observer. */
export function initThemeCustomization(): () => void {
  applyCustomizationVars(currentMode());
  if (typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(() => applyCustomizationVars(currentMode()));
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

/** Live customization record; re-reads on every accepted write so any
 * consumer (ConfigProvider in App.tsx, the settings pane) follows the same
 * single source. */
export function useThemeCustomization(): ThemeCustomization {
  const [custom, setCustom] = useState<ThemeCustomization>(readStoredCustomization);
  useEffect(() => {
    const sync = (): void => setCustom(readStoredCustomization());
    window.addEventListener(THEME_CUSTOM_EVENT, sync);
    return () => window.removeEventListener(THEME_CUSTOM_EVENT, sync);
  }, []);
  return custom;
}

/** Derive the antd color tokens from an effective palette (#246 REQ-04: one
 * dataset feeding both the CSS custom properties and the antd cssinjs
 * layer). Every token maps to exactly one semantic key; geometry and shadow
 * tokens are not colors and stay with the caller. Applied to the `roleweave`
 * preset this reproduces the previous hand-synchronized seed exactly — the
 * renderer tests pin that equality. */
export function antdColorTokensForPalette(p: FullPalette) {
  return {
    colorPrimary: p.primary,
    colorPrimaryHover: p["primary-hover"],
    colorPrimaryActive: p["primary-hover"],
    colorPrimaryBg: p["primary-soft"],
    colorPrimaryBgHover: p["primary-soft"],
    colorPrimaryBorder: p.border,
    colorPrimaryBorderHover: p["border-strong"],
    colorSuccess: p.success,
    colorSuccessHover: p["success-strong"],
    colorSuccessActive: p["success-strong"],
    colorSuccessBg: p["success-soft"],
    colorSuccessBgHover: p["success-soft"],
    colorSuccessBorder: p.border,
    colorSuccessBorderHover: p["border-strong"],
    colorWarning: p.warning,
    colorWarningHover: p["warning-strong"],
    colorWarningActive: p["warning-strong"],
    colorWarningBg: p["warning-soft"],
    colorWarningBgHover: p["warning-soft"],
    colorWarningBorder: p.border,
    colorWarningBorderHover: p["border-strong"],
    colorError: p.danger,
    colorErrorHover: p["danger-strong"],
    colorErrorActive: p["danger-strong"],
    colorErrorBg: p["danger-soft"],
    colorErrorBgHover: p["danger-soft"],
    colorErrorBorder: p.border,
    colorErrorBorderHover: p["border-strong"],
    colorInfo: p.info,
    colorInfoHover: p["primary-hover"],
    colorInfoActive: p["primary-hover"],
    colorInfoBg: p["info-soft"],
    colorInfoBgHover: p["info-soft"],
    colorInfoBorder: p.border,
    colorInfoBorderHover: p["border-strong"],
    colorErrorBgFilledHover: p["danger-soft"],
    colorErrorBgActive: p["danger-soft"],
    colorLink: p.primary,
    colorLinkHover: p["primary-hover"],
    colorLinkActive: p["primary-hover"],
    colorBorder: p.border,
    colorBorderSecondary: p.border,
    colorBgBase: p.surface,
    colorBgContainer: p.surface,
    colorBgElevated: p["surface-raised"],
    colorBgLayout: p.canvas,
    colorFillAlter: p["surface-inset"],
    controlItemBgHover: p["navigation-hover"],
    controlItemBgActive: p.selection,
    controlItemBgActiveHover: p.selection,
    colorText: p.foreground,
    colorTextSecondary: p["foreground-muted"],
    colorTextTertiary: p["foreground-subtle"],
    colorTextPlaceholder: p["foreground-subtle"],
    colorTextDisabled: p["foreground-subtle"],
    colorBgContainerDisabled: p["surface-inset"],
    colorTextLightSolid: p["primary-foreground"],
  } as const;
}
