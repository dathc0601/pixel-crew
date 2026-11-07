// Static layer cache (plan P4.2). The floor, walls, furniture and room names are drawn
// once into an offscreen canvas; a frame blits it and then redraws only the areas the
// characters cover. Inside those areas everything is drawn again in the usual z order
// (floor first, then every static item that touches the area plus the characters), so
// the result is the same picture a full redraw makes, pixel for pixel. The cache is
// rebuilt whenever anything it depends on changes (layout, furniture state, theme
// colors, zoom, pan, canvas size, device pixel ratio).

import type { Box, ZDrawable } from './renderer'

interface Layer {
  key: readonly unknown[]
  canvas: HTMLCanvasElement
  /** Static drawables in their original order (ties in z keep this order) */
  items: ZDrawable[]
}

let layer: Layer | null = null

/** Rebuild count, for perf checks */
export const staticLayerStats = { builds: 0 }

declare global {
  interface Window {
    /** Debug switches: staticCache=false draws every frame in full (for screenshot comparisons) */
    __pixelCrewDebug?: { staticCache?: boolean; redraw?: () => void }
  }
}

export function staticCacheEnabled(): boolean {
  return typeof document !== 'undefined' && (typeof window === 'undefined' || window.__pixelCrewDebug?.staticCache !== false)
}

/** Drop the cached layer (tests, or when the scene goes away). */
export function resetStaticLayer(): void {
  layer = null
}

function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

function drawSorted(ctx: CanvasRenderingContext2D, items: Array<{ d: ZDrawable; i: number }>): void {
  items.sort((a, b) => (a.d.zY - b.d.zY) || (a.i - b.i))
  for (const { d } of items) d.draw(ctx)
}

/**
 * Draw the static scene from the cache, then the dynamic drawables. Returns false (and
 * draws nothing) when the canvas transform is not a plain scale, so the caller can fall
 * back to a full redraw.
 *
 * @param key        everything the static picture depends on (compared with ===)
 * @param paintFloor draws the floor (or background image), optionally only around an area
 * @param staticItems builds the z-sorted static drawables (walls, furniture, labels)
 * @param dynamic    characters; each needs a box
 */
export function renderWithStaticLayer(
  ctx: CanvasRenderingContext2D,
  key: readonly unknown[],
  paintFloor: (c: CanvasRenderingContext2D, area?: Box) => void,
  staticItems: () => ZDrawable[],
  dynamic: ZDrawable[],
): boolean {
  const m = ctx.getTransform()
  const dpr = m.a
  if (m.b !== 0 || m.c !== 0 || m.d !== dpr || m.e !== 0 || m.f !== 0 || dpr <= 0) return false
  if (dynamic.some((d) => !d.box)) return false
  const devW = ctx.canvas.width
  const devH = ctx.canvas.height
  const fullKey = [...key, devW, devH, dpr]

  if (!layer || !sameKey(layer.key, fullKey)) {
    const canvas = layer?.canvas ?? document.createElement('canvas')
    canvas.width = devW
    canvas.height = devH
    const lctx = canvas.getContext('2d')
    if (!lctx) return false
    lctx.setTransform(m)
    lctx.clearRect(0, 0, devW / dpr, devH / dpr)
    lctx.imageSmoothingEnabled = false
    paintFloor(lctx)
    const items = staticItems()
    drawSorted(lctx, items.map((d, i) => ({ d, i })))
    layer = { key: fullKey, canvas, items }
    staticLayerStats.builds++
  }

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(layer.canvas, 0, 0)
  ctx.restore()
  if (dynamic.length === 0) return true

  // Areas the characters cover, snapped out to whole device pixels. Each area is redrawn
  // on its own with a plain rectangle clip (exact; a multi-rect path clip can blend corner
  // pixels). Overlapping areas are simply redrawn twice, which gives the same pixels.
  const base = layer.items.length
  for (const d of dynamic) {
    const b = d.box!
    const x0 = Math.max(0, Math.floor(b.x0 * dpr))
    const y0 = Math.max(0, Math.floor(b.y0 * dpr))
    const x1 = Math.min(devW, Math.ceil(b.x1 * dpr))
    const y1 = Math.min(devH, Math.ceil(b.y1 * dpr))
    if (x1 <= x0 || y1 <= y0) continue
    const r = { x0: x0 / dpr, y0: y0 / dpr, x1: x1 / dpr, y1: y1 / dpr }
    ctx.save()
    ctx.beginPath()
    ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0)
    ctx.clip()
    ctx.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0)
    ctx.imageSmoothingEnabled = false
    paintFloor(ctx, r)
    const items: Array<{ d: ZDrawable; i: number }> = []
    layer.items.forEach((s, i) => {
      if (!s.box || overlaps(s.box, r)) items.push({ d: s, i })
    })
    dynamic.forEach((c, i) => {
      if (overlaps(c.box!, r)) items.push({ d: c, i: base + i })
    })
    drawSorted(ctx, items)
    ctx.restore()
  }
  return true
}
