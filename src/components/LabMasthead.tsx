import { BookOpen } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

export function LabMasthead({
  context = "Quantitative learning atlas",
}: {
  readonly context?: string;
}) {
  return (
    <header className="masthead lab-masthead">
      <a className="wordmark" href="#/" aria-label="Montepathfolio laboratory index">
        <span className="wordmark__seal" aria-hidden="true">
          MP
        </span>
        <span>
          <strong>Montepathfolio</strong>
          <small>{context}</small>
        </span>
      </a>
      <div className="masthead__actions">
        <a className="text-link" href="#learning-method">
          <BookOpen size={16} strokeWidth={1.8} aria-hidden="true" />
          How to learn here
        </a>
        <ThemeToggle />
      </div>
    </header>
  );
}
