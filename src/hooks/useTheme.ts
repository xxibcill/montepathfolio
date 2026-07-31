import { useEffect, useState } from "react";
import {
  applyTheme,
  currentTheme,
  THEME_CHANGE_EVENT,
  type Theme,
} from "../lib/theme";

export function useTheme(): readonly [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    applyTheme(next);
    setTheme(next);
  };

  return [theme, toggle] as const;
}
export function useThemeRevision(): number {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const redraw = () => setRevision((current) => current + 1);
    window.addEventListener(THEME_CHANGE_EVENT, redraw);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, redraw);
  }, []);

  return revision;
}
