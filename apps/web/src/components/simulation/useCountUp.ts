"use client";

import { useEffect, useRef, useState } from "react";

const reducedMotion = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A number that rolls from its previous value to the new one; the studio's counters, not a fake progress. */
export const useCountUp = (value: number, duration = 550): number => {
  const [shown, setShown] = useState(value);
  const previous = useRef(value);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (from === value || reducedMotion()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const raf = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame.bind(window) : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);
    const cancel = typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame.bind(window) : window.clearTimeout.bind(window);
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) frame = raf(tick);
    };
    frame = raf(tick);
    return () => cancel(frame);
  }, [value, duration]);
  return shown;
};
