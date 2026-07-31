import { useEffect, useRef, useState } from "react";

export interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

interface CanvasSizeOptions {
  aspectRatio?: number;
  minHeight?: number;
  maxHeight?: number;
}

/**
 * Measures a chart's container in CSS pixels and tracks the device pixel ratio.
 * Consumers should use the returned dimensions for drawing and multiply the
 * canvas backing store by `dpr`.
 */
export function useCanvasSize({
  aspectRatio = 2,
  minHeight = 240,
  maxHeight = 420,
}: CanvasSizeOptions = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CanvasSize>({
    width: 0,
    height: minHeight,
    dpr: 1,
  });

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const measure = (observedWidth?: number) => {
      const measuredWidth =
        observedWidth ?? container.getBoundingClientRect().width;
      const width = Math.max(0, Math.floor(measuredWidth));
      const height = Math.round(
        Math.min(maxHeight, Math.max(minHeight, width / aspectRatio)),
      );
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      setSize((current) => {
        if (
          current.width === width &&
          current.height === height &&
          current.dpr === dpr
        ) {
          return current;
        }

        return { width, height, dpr };
      });
    };

    measure();

    const onWindowResize = () => measure();
    window.addEventListener("resize", onWindowResize);

    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", onWindowResize);
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        measure(entry.contentRect.width);
      }
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [aspectRatio, maxHeight, minHeight]);

  return { containerRef, ...size };
}
