/** Theme section of the settings surface (#246).
 *
 * First slice entry points: built-in preset switch, per-key color edits for
 * the active light/dark mode, and reset. Edits go through
 * `storeCustomization()`, so everything written here is sanitized and lands
 * on the same single theme record that presets and (later) constrained
 * Agent generation share.
 *
 * Only hex-representable keys get a live picker; values like rgba overlays
 * render read-only so the picker never mis-represents them.
 */
import { useCallback, useMemo } from "react";
import { Button, Radio } from "antd";
import { useT } from "@roleweave/ui";
import {
  effectivePalette,
  isDefaultCustomization,
  storeCustomization,
  clearStoredCustomization,
  useThemeCustomization,
  type SemanticColorKey,
  type ThemePresetId,
} from "../theme-customization";
import { useThemeMode } from "../theme-toggle";

/** Keys the v1 picker exposes. The full semantic contract stays open for
 * presets and overrides; this list is which of them get a first-class
 * editing affordance. */
const PICKER_KEYS: SemanticColorKey[] = [
  "canvas",
  "surface",
  "surface-raised",
  "surface-inset",
  "foreground",
  "foreground-subtle",
  "border",
  "navigation",
  "navigation-hover",
  "primary",
  "primary-hover",
  "primary-soft",
  "brand",
  "ai",
  "info",
  "success",
  "warning",
  "danger",
  "focus",
  "selection",
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function ThemeSettings() {
  const t = useT();
  const mode = useThemeMode();
  const custom = useThemeCustomization();
  const palette = useMemo(() => effectivePalette(custom, mode), [custom, mode]);

  const switchPreset = useCallback(
    (preset: ThemePresetId) => {
      storeCustomization({ ...custom, preset });
    },
    [custom],
  );

  const setColor = useCallback(
    (key: SemanticColorKey, value: string) => {
      storeCustomization({
        ...custom,
        overrides: {
          ...custom.overrides,
          [mode]: { ...custom.overrides[mode], [key]: value },
        },
      });
    },
    [custom, mode],
  );

  const reset = useCallback(() => {
    clearStoredCustomization();
  }, []);

  return (
    <section className="owb-settings-module__pane" aria-label={t("settings.themeTitle")}>
      <header className="owb-settings-module__pane-header">
        <h2>{t("settings.themeTitle")}</h2>
      </header>
      <p>{t("settings.themeHint")}</p>

      <Radio.Group
        value={custom.preset}
        onChange={(event) => switchPreset(event.target.value as ThemePresetId)}
      >
        <Radio value="roleweave">{t("settings.themePresetRoleweave")}</Radio>
        <Radio value="antd">{t("settings.themePresetAntd")}</Radio>
      </Radio.Group>

      <h3>{t("settings.themeColors")}</h3>
      <div role="group" aria-label={t("settings.themeColors")} style={{ display: "grid", gap: 8 }}>
        {PICKER_KEYS.map((key) => {
          const value = palette[key];
          const editable = HEX_RE.test(value);
          return (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ minWidth: 160 }}>{t(`settings.themeKey.${key}`)}</span>
              <input
                type="color"
                aria-label={t(`settings.themeKey.${key}`)}
                value={editable ? value : "#000000"}
                disabled={!editable}
                onChange={(event) => setColor(key, event.target.value)}
              />
              {!editable ? <code>{value}</code> : null}
            </label>
          );
        })}
      </div>

      <div style={{ marginTop: 12 }}>
        <Button onClick={reset} disabled={isDefaultCustomization(custom)}>
          {t("settings.themeReset")}
        </Button>
      </div>
    </section>
  );
}
