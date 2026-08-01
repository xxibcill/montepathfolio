import { useEffect, type RefObject } from "react";

export function usePageFocus(
  pageKey: string,
  mainRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      mainRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mainRef, pageKey]);
}
