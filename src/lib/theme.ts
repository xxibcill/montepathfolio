export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "montepathfolio/theme";
export const THEME_CHANGE_EVENT = "montepathfolio-theme-change";

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}
export function preferredTheme(): Theme {
  const stored = storedTheme();
  if (stored) return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme, persist = true): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme selection still applies for this session when storage is blocked.
    }
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
}

export function initializeTheme(): void {
  applyTheme(preferredTheme(), false);
}
