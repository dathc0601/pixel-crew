// Debug-only console output. On in dev builds, or in any build after
// `localStorage.pixelCrewDebug = "1"` (reload to apply). Real warnings and errors
// still go straight to console.warn / console.error.

let cached: boolean | null = null;

export function isDebugEnabled(): boolean {
  if (cached !== null) return cached;
  let on = process.env.NODE_ENV !== "production";
  if (!on && typeof window !== "undefined") {
    try {
      on = window.localStorage.getItem("pixelCrewDebug") === "1";
    } catch {
      /* storage blocked */
    }
  }
  cached = on;
  return on;
}

export function debugLog(...args: unknown[]): void {
  if (isDebugEnabled()) console.log(...args);
}
