import { Component, type ErrorInfo, type ReactNode } from "react";

export class AppErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Montepathfolio page failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-shell fatal-error" tabIndex={-1}>
        <p className="eyebrow">Page recovery</p>
        <h1>This laboratory could not be displayed.</h1>
        <p>The current page hit an unexpected error. Your locally saved inputs remain available.</p>
        <div>
          <a href="#/">Return to the laboratory index</a>
          <button type="button" onClick={() => window.location.reload()}>
            Reload this page
          </button>
        </div>
      </main>
    );
  }
}
