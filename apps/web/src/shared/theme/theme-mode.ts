import { createContext, use } from "react";

/** The colour mode the coordinator chose; the app never follows the system setting. */
export type ThemeMode = "light" | "dark";

/** Remembered per browser; anything missing, invalid or unreadable means light. */
export const THEME_STORAGE_KEY = "event-desk:theme";

export function readStoredThemeMode(): ThemeMode {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    // Storage blocked (private mode, site data disabled): the default applies.
    return "light";
  }
}

export function storeThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Not remembered, but the switch still applies for this page.
  }
}

export interface ThemeModeControl {
  mode: ThemeMode;
  toggle: () => void;
}

export const ThemeModeContext = createContext<ThemeModeControl>({
  mode: "light",
  toggle: () => undefined,
});

/** The current mode and its switch; provided by AppProviders. */
export function useThemeMode(): ThemeModeControl {
  return use(ThemeModeContext);
}
