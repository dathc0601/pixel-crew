"use client";

import { useCallback } from "react";

/**
 * UI that floats over the office canvas (the status bar on top, the Boss shortcuts and the
 * agent bar at the bottom) registers here, so narrow views can fit the map into the band
 * between them instead of centering it behind the overlays.
 */
export type SceneInsetSide = "top" | "bottom";

export interface SceneInsets {
  top: number;
  bottom: number;
}

const entries = new Map<Element, SceneInsetSide>();
const listeners = new Set<() => void>();
let observer: ResizeObserver | null = null;

function notify() {
  for (const l of listeners) l();
}

function getObserver(): ResizeObserver | null {
  if (observer || typeof ResizeObserver === "undefined") return observer;
  observer = new ResizeObserver(() => notify());
  return observer;
}

/** Register an overlay element; returns the unregister function. */
export function registerSceneInset(el: Element, side: SceneInsetSide): () => void {
  entries.set(el, side);
  getObserver()?.observe(el);
  notify();
  return () => {
    entries.delete(el);
    observer?.unobserve(el);
    notify();
  };
}

/** Ask the scene to refit (a new layout loaded); only narrow views act on it. */
export function requestSceneRefit(): void {
  notify();
}

/** Called whenever a registered overlay mounts, unmounts or changes size. */
export function onSceneInsetsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * How far the registered overlays reach into `area` (the canvas rect), per side.
 * Hidden overlays (zero size) don't count; each side is capped at a third of the height.
 */
export function measureSceneInsets(area: { top: number; bottom: number; height: number }): SceneInsets {
  let top = 0;
  let bottom = 0;
  for (const [el, side] of entries) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (side === "top") top = Math.max(top, r.bottom - area.top);
    else bottom = Math.max(bottom, area.bottom - r.top);
  }
  const cap = area.height / 3;
  return {
    top: Math.round(Math.min(cap, Math.max(0, top))),
    bottom: Math.round(Math.min(cap, Math.max(0, bottom))),
  };
}

/** Ref callback for an overlay element: `<div ref={useSceneInset("bottom")}>`. */
export function useSceneInset(side: SceneInsetSide) {
  return useCallback((el: HTMLElement | null) => {
    if (!el) return;
    return registerSceneInset(el, side);
  }, [side]);
}
