/**
 * #246 semantic color customization: presets, overrides, validation,
 * persistence, and the unified antd derivation.
 *
 * The regression anchor: applying the derivation to the built-in `roleweave`
 * preset must reproduce the hand-synchronized ANTD_SEED that App.tsx shipped
 * before #246 exactly. Any drift here is a visual change for every default
 * user, so the expected objects are spelled out, not recomputed.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useEffect, useState } from "react";
import {
  DEFAULT_CUSTOMIZATION,
  SEMANTIC_COLOR_KEYS,
  THEME_CUSTOM_EVENT,
  THEME_CUSTOM_STORAGE_KEY,
  THEME_PRESETS,
  antdColorTokensForPalette,
  applyCustomizationVars,
  clearStoredCustomization,
  effectivePalette,
  isDefaultCustomization,
  isValidColorLiteral,
  readStoredCustomization,
  sanitizeCustomization,
  sanitizePalette,
  storeCustomization,
  type ThemeCustomization,
} from "../src/theme-customization";

const LEGACY_ANTD_SEED_LIGHT = {
  colorPrimary: "#3e63dd",
  colorPrimaryHover: "#3153c4",
  colorPrimaryActive: "#3153c4",
  colorPrimaryBg: "#edf1ff",
  colorPrimaryBgHover: "#edf1ff",
  colorPrimaryBorder: "#e2e5ed",
  colorPrimaryBorderHover: "#c7cedb",
  colorSuccess: "#2e7052",
  colorSuccessHover: "#24573f",
  colorSuccessActive: "#24573f",
  colorSuccessBg: "#edf7f1",
  colorSuccessBgHover: "#edf7f1",
  colorSuccessBorder: "#e2e5ed",
  colorSuccessBorderHover: "#c7cedb",
  colorWarning: "#8a5a12",
  colorWarningHover: "#75480b",
  colorWarningActive: "#75480b",
  colorWarningBg: "#fff5e4",
  colorWarningBgHover: "#fff5e4",
  colorWarningBorder: "#e2e5ed",
  colorWarningBorderHover: "#c7cedb",
  colorError: "#b83d3d",
  colorErrorHover: "#a22f36",
  colorErrorActive: "#a22f36",
  colorErrorBg: "#fff0f0",
  colorErrorBgHover: "#fff0f0",
  colorErrorBorder: "#e2e5ed",
  colorErrorBorderHover: "#c7cedb",
  colorInfo: "#3e63dd",
  colorInfoHover: "#3153c4",
  colorInfoActive: "#3153c4",
  colorInfoBg: "#edf1ff",
  colorInfoBgHover: "#edf1ff",
  colorInfoBorder: "#e2e5ed",
  colorInfoBorderHover: "#c7cedb",
  colorErrorBgFilledHover: "#fff0f0",
  colorErrorBgActive: "#fff0f0",
  colorLink: "#3e63dd",
  colorLinkHover: "#3153c4",
  colorLinkActive: "#3153c4",
  colorBorder: "#e2e5ed",
  colorBorderSecondary: "#e2e5ed",
  colorBgBase: "#ffffff",
  colorBgContainer: "#ffffff",
  colorBgElevated: "#ffffff",
  colorBgLayout: "#f7f8fb",
  colorFillAlter: "#f4f5f8",
  controlItemBgHover: "#e8ebf2",
  controlItemBgActive: "#f3edfc",
  controlItemBgActiveHover: "#f3edfc",
  colorText: "#242630",
  colorTextSecondary: "#596172",
  colorTextTertiary: "#606a7b",
  colorTextPlaceholder: "#606a7b",
  colorTextDisabled: "#606a7b",
  colorBgContainerDisabled: "#f4f5f8",
  colorTextLightSolid: "#ffffff",
};

const LEGACY_ANTD_SEED_DARK = {
  colorPrimary: "#86a0ff",
  colorPrimaryHover: "#a0b4ff",
  colorPrimaryActive: "#a0b4ff",
  colorPrimaryBg: "#252e49",
  colorPrimaryBgHover: "#252e49",
  colorPrimaryBorder: "#343844",
  colorPrimaryBorderHover: "#4b5262",
  colorSuccess: "#84c7a3",
  colorSuccessHover: "#a2dabb",
  colorSuccessActive: "#a2dabb",
  colorSuccessBg: "#20372c",
  colorSuccessBgHover: "#20372c",
  colorSuccessBorder: "#343844",
  colorSuccessBorderHover: "#4b5262",
  colorWarning: "#ddb35d",
  colorWarningHover: "#efcc86",
  colorWarningActive: "#efcc86",
  colorWarningBg: "#352e20",
  colorWarningBgHover: "#352e20",
  colorWarningBorder: "#343844",
  colorWarningBorderHover: "#4b5262",
  colorError: "#ef9699",
  colorErrorHover: "#ffb1b4",
  colorErrorActive: "#ffb1b4",
  colorErrorBg: "#3a242b",
  colorErrorBgHover: "#3a242b",
  colorErrorBorder: "#343844",
  colorErrorBorderHover: "#4b5262",
  colorInfo: "#86a0ff",
  colorInfoHover: "#a0b4ff",
  colorInfoActive: "#a0b4ff",
  colorInfoBg: "#252e49",
  colorInfoBgHover: "#252e49",
  colorInfoBorder: "#343844",
  colorInfoBorderHover: "#4b5262",
  colorErrorBgFilledHover: "#3a242b",
  colorErrorBgActive: "#3a242b",
  colorLink: "#86a0ff",
  colorLinkHover: "#a0b4ff",
  colorLinkActive: "#a0b4ff",
  colorBorder: "#343844",
  colorBorderSecondary: "#343844",
  colorBgBase: "#1c1e25",
  colorBgContainer: "#1c1e25",
  colorBgElevated: "#252831",
  colorBgLayout: "#14151b",
  colorFillAlter: "#171920",
  controlItemBgHover: "#252831",
  controlItemBgActive: "#30233f",
  controlItemBgActiveHover: "#30233f",
  colorText: "#e5e7ed",
  colorTextSecondary: "#b1b7c5",
  colorTextTertiary: "#969eaf",
  colorTextPlaceholder: "#969eaf",
  colorTextDisabled: "#969eaf",
  colorBgContainerDisabled: "#171920",
  colorTextLightSolid: "#14151b",
};

beforeEach(() => {
  window.localStorage.clear();
  for (const key of SEMANTIC_COLOR_KEYS) {
    document.documentElement.style.removeProperty(`--ui-${key}`);
  }
  document.documentElement.setAttribute("data-theme", "light");
});

describe("regression anchor: roleweave preset reproduces the legacy seed", () => {
  it("derives the exact legacy light antd tokens", () => {
    expect(antdColorTokensForPalette(THEME_PRESETS.roleweave.light)).toEqual(LEGACY_ANTD_SEED_LIGHT);
  });

  it("derives the exact legacy dark antd tokens", () => {
    expect(antdColorTokensForPalette(THEME_PRESETS.roleweave.dark)).toEqual(LEGACY_ANTD_SEED_DARK);
  });

  it("every preset defines every semantic key in both modes", () => {
    for (const preset of Object.values(THEME_PRESETS)) {
      for (const mode of ["light", "dark"] as const) {
        for (const key of SEMANTIC_COLOR_KEYS) {
          expect(preset[mode][key], `preset missing ${mode}/${key}`).toBeTruthy();
          expect(isValidColorLiteral(preset[mode][key]), `preset invalid ${mode}/${key}`).toBe(true);
        }
      }
    }
  });
});

describe("color literal validation (REQ-05)", () => {
  it("accepts hex and rgb/rgba literals", () => {
    for (const value of ["#1677ff", "#fff", "rgb(0, 0, 0)", "rgba(20, 21, 27, 0.35)", "rgba(0, 0, 0, 1)"]) {
      expect(isValidColorLiteral(value), value).toBe(true);
    }
  });

  it("rejects anything a stylesheet could interpret as more than a color", () => {
    for (const value of [
      "url(https://example.com/x.png)",
      "var(--ui-primary)",
      "calc(100% - 1px)",
      "red; background: url(x)",
      "#12345",
      "rgba(300, 0, 0, 0.5)",
      "",
      42,
      null,
      undefined,
    ]) {
      expect(isValidColorLiteral(value), String(value)).toBe(false);
    }
  });
});

describe("sanitization (REQ-05)", () => {
  it("drops unknown keys and invalid values, keeps the rest", () => {
    const palette = sanitizePalette({
      primary: "#1677ff",
      "not-a-key": "#ff0000",
      danger: "javascript:alert(1)",
      surface: 123,
    });
    expect(palette).toEqual({ primary: "#1677ff" });
  });

  it("degrades a corrupt record to the default instead of throwing", () => {
    for (const raw of [null, 42, "roleweave", [], { preset: "hacker", overrides: "x" }]) {
      const clean = sanitizeCustomization(raw);
      expect(clean.preset).toBe("roleweave");
      expect(clean.overrides.light).toEqual({});
      expect(clean.overrides.dark).toEqual({});
    }
  });

  it("keeps a valid record intact", () => {
    const clean = sanitizeCustomization({
      preset: "antd",
      overrides: { light: { primary: "#1677ff" }, dark: { primary: "#1668dc", bogus: "#000" } },
    });
    expect(clean.preset).toBe("antd");
    expect(clean.overrides.light).toEqual({ primary: "#1677ff" });
    expect(clean.overrides.dark).toEqual({ primary: "#1668dc" });
  });
});

describe("effective palette (REQ-01, REQ-03 partial edits)", () => {
  it("layers per-mode overrides over the preset without cross-mode leakage", () => {
    const custom: ThemeCustomization = {
      preset: "roleweave",
      overrides: { light: { primary: "#0000ff" }, dark: {} },
    };
    expect(effectivePalette(custom, "light").primary).toBe("#0000ff");
    expect(effectivePalette(custom, "dark").primary).toBe(THEME_PRESETS.roleweave.dark.primary);
    // Unrelated keys survive the partial edit.
    expect(effectivePalette(custom, "light").danger).toBe(THEME_PRESETS.roleweave.light.danger);
  });
});

describe("persistence and application (REQ-02, REQ-04)", () => {
  it("reads the default when nothing is stored", () => {
    expect(readStoredCustomization()).toEqual(DEFAULT_CUSTOMIZATION);
    expect(isDefaultCustomization(readStoredCustomization())).toBe(true);
  });

  it("reads a corrupt stored record as the default", () => {
    window.localStorage.setItem(THEME_CUSTOM_STORAGE_KEY, "{not json");
    expect(readStoredCustomization()).toEqual(DEFAULT_CUSTOMIZATION);
  });

  it("stores sanitized data and stamps inline vars for a non-default preset", () => {
    storeCustomization({ preset: "antd", overrides: { light: {}, dark: {} } });

    const stored = JSON.parse(window.localStorage.getItem(THEME_CUSTOM_STORAGE_KEY) ?? "");
    expect(stored.preset).toBe("antd");
    expect(document.documentElement.style.getPropertyValue("--ui-primary")).toBe("#1677ff");

    // Dark mode re-resolves the per-mode palette.
    document.documentElement.setAttribute("data-theme", "dark");
    applyCustomizationVars("dark");
    expect(document.documentElement.style.getPropertyValue("--ui-primary")).toBe("#1668dc");
  });

  it("applies user overrides on top of the preset vars", () => {
    storeCustomization({
      preset: "roleweave",
      overrides: { light: { primary: "#00ff00" }, dark: {} },
    });
    expect(document.documentElement.style.getPropertyValue("--ui-primary")).toBe("#00ff00");
  });

  it("leaves the stylesheet in charge for the default customization", () => {
    storeCustomization({ preset: "roleweave", overrides: { light: {}, dark: {} } });
    expect(document.documentElement.style.getPropertyValue("--ui-primary")).toBe("");
  });

  it("clear restores the stylesheet layer and removes the stored record", () => {
    storeCustomization({ preset: "antd", overrides: { light: {}, dark: {} } });
    expect(document.documentElement.style.getPropertyValue("--ui-primary")).not.toBe("");

    clearStoredCustomization();
    expect(window.localStorage.getItem(THEME_CUSTOM_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--ui-primary")).toBe("");
  });

  it("never stores an unwhitelisted key even when forced through the write path", () => {
    storeCustomization({
      preset: "roleweave",
      overrides: { light: { "--evil": "1", primary: "#123456" } as never, dark: {} },
    });
    const stored = JSON.parse(window.localStorage.getItem(THEME_CUSTOM_STORAGE_KEY) ?? "");
    expect(stored.overrides.light).toEqual({ primary: "#123456" });
  });

  it("notifies listeners after an accepted write", () => {
    let events = 0;
    const listener = (): void => {
      events += 1;
    };
    window.addEventListener(THEME_CUSTOM_EVENT, listener);
    try {
      storeCustomization({ preset: "antd", overrides: { light: {}, dark: {} } });
      expect(events).toBe(1);
      clearStoredCustomization();
      expect(events).toBe(2);
    } finally {
      window.removeEventListener(THEME_CUSTOM_EVENT, listener);
    }
  });
});

describe("react reader re-renders on customization changes", () => {
  function ReaderHarness() {
    const [custom, setCustom] = useState(readStoredCustomization);
    useEffect(() => {
      const sync = (): void => setCustom(readStoredCustomization());
      window.addEventListener(THEME_CUSTOM_EVENT, sync);
      return () => window.removeEventListener(THEME_CUSTOM_EVENT, sync);
    }, []);
    return <span data-testid="preset">{custom.preset}</span>;
  }

  it("observes a preset switch through the change event", () => {
    render(<ReaderHarness />);
    expect(screen.getByTestId("preset")).toHaveTextContent("roleweave");

    act(() => {
      storeCustomization({ preset: "antd", overrides: { light: {}, dark: {} } });
    });

    expect(screen.getByTestId("preset")).toHaveTextContent("antd");
  });
});

describe("settings entry point (REQ-02)", () => {
  /* The dynamic ThemeSettings import pulls antd in fresh; under full-suite
     load that can exceed the default 5s, so give it explicit headroom. */
  it("switches preset, edits one color, and resets", async () => {
    const { ThemeSettings } = await import("../src/settings/ThemeSettings");
    render(<ThemeSettings />);
    // Switch to the antd preset.
    fireEvent.click(screen.getByRole("radio", { name: /Ant Design/ }));
    expect(readStoredCustomization().preset).toBe("antd");
    expect(document.documentElement.style.getPropertyValue("--ui-primary")).toBe("#1677ff");

    // Edit a single semantic color in the active (light) mode.
    const primaryInput = screen.getByLabelText("主操作") as HTMLInputElement;
    fireEvent.change(primaryInput, { target: { value: "#0055cc" } });
    expect(readStoredCustomization().overrides.light.primary).toBe("#0055cc");
    expect(document.documentElement.style.getPropertyValue("--ui-primary")).toBe("#0055cc");
    // The edit does not touch dark.
    expect(readStoredCustomization().overrides.dark.primary).toBeUndefined();

    // Reset clears overrides and restores the default preset.
    fireEvent.click(screen.getByRole("button", { name: /Reset|恢复/ }));
    expect(readStoredCustomization()).toEqual(DEFAULT_CUSTOMIZATION);
    expect(document.documentElement.style.getPropertyValue("--ui-primary")).toBe("");
  }, 15000);
});
