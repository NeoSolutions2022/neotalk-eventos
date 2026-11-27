"use client";

import { useEffect, type RefObject } from "react";
import { keepScreenAwake } from "./screenWakeLock";

export function useScreenWakeLock(active: boolean, target?: RefObject<Window | null>) {
  useEffect(() => {
    if (!active) return;
    const output = target ? target.current : window;
    if (!output) return;
    try {
      return keepScreenAwake(output);
    } catch {
      // A detached popup may already have closed or moved to another origin.
    }
  }, [active, target]);
}
