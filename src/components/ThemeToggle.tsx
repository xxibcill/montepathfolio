import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

export function ThemeToggle() {
  const [theme, toggleTheme] = useTheme();
  const nextTheme = theme === "light" ? "dark" : "light";

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} theme`}
      title={`Switch to ${nextTheme} theme`}
    >
      {theme === "light" ? (
        <Moon size={17} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <Sun size={17} strokeWidth={1.8} aria-hidden="true" />
      )}
    </button>
  );
}
