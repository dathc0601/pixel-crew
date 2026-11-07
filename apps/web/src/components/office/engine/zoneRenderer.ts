// Room names painted on the floor of zoned layouts ("BOSS", "LEAD", "DEV TEAM", …), and
// the zone tint the layout editor shows. Drawn right after the floor, under furniture.

import { TILE_SIZE } from '../types'
import type { OfficeLayout, ZoneKind } from '../types'
import { getCatalogEntry } from '../layout/furnitureCatalog'
import { ZONE_LABELS, ZONE_TINTS } from '../layout/zones'

interface LabelSpot { kind: ZoneKind; x: number; y: number }

const spotCache = new WeakMap<OfficeLayout, LabelSpot[]>()

/** Where each zone's name goes: the first row (top down) with three free tiles around the zone's center column. */
export function zoneLabelSpots(layout: OfficeLayout): LabelSpot[] {
  const cached = spotCache.get(layout)
  if (cached) return cached
  const spots: LabelSpot[] = []
  const zones = layout.zones
  if (zones) {
    // Tiles covered by furniture (rugs and other floor-level pieces do not count), and chairs:
    // a name right above a chair would sit under that agent's head
    const occupied = new Set<string>()
    const chairs = new Set<string>()
    for (const f of layout.furniture) {
      const e = getCatalogEntry(f.type)
      if (!e || e.canPlaceOnWalls || (e.backgroundTiles ?? 0) >= e.footprintH) continue
      for (let dr = 0; dr < e.footprintH; dr++) {
        for (let dc = 0; dc < e.footprintW; dc++) {
          occupied.add(`${f.col + dc},${f.row + dr}`)
          if (e.category === 'chairs') chairs.add(`${f.col + dc},${f.row + dr}`)
        }
      }
    }
    const boxes = new Map<ZoneKind, { c0: number; r0: number; c1: number; r1: number }>()
    zones.forEach((z, i) => {
      if (!z) return
      const c = i % layout.cols
      const r = Math.floor(i / layout.cols)
      const b = boxes.get(z)
      if (!b) boxes.set(z, { c0: c, r0: r, c1: c, r1: r })
      else { b.c0 = Math.min(b.c0, c); b.r0 = Math.min(b.r0, r); b.c1 = Math.max(b.c1, c); b.r1 = Math.max(b.r1, r) }
    })
    for (const [kind, b] of boxes) {
      const cx = Math.floor((b.c0 + b.c1) / 2)
      const half = b.c1 - b.c0 >= 4 ? 1 : 0
      for (let r = b.r0; r <= b.r1; r++) {
        let ok = true
        for (let c = cx - half; c <= cx + half + (b.c1 - b.c0) % 2; c++) {
          if (zones[r * layout.cols + c] !== kind || occupied.has(`${c},${r}`) || chairs.has(`${c},${r + 1}`)) { ok = false; break }
        }
        if (ok) {
          spots.push({ kind, x: ((b.c0 + b.c1 + 1) / 2) * TILE_SIZE, y: r * TILE_SIZE + TILE_SIZE / 2 })
          break
        }
      }
    }
  }
  spotCache.set(layout, spots)
  return spots
}

/** Editor only: tint every zoned tile with its zone's color (drawn right after the floor). */
export function renderZoneTint(
  ctx: CanvasRenderingContext2D,
  layout: OfficeLayout,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const zones = layout.zones
  if (!zones) return
  const s = TILE_SIZE * zoom
  ctx.save()
  zones.forEach((z, i) => {
    if (!z) return
    ctx.fillStyle = ZONE_TINTS[z]
    ctx.fillRect(offsetX + (i % layout.cols) * s, offsetY + Math.floor(i / layout.cols) * s, s, s)
  })
  ctx.restore()
}

/**
 * Room names as z-sorted drawables: above rugs and the floor, below furniture and
 * characters that stand further down the screen.
 */
export function zoneLabelDrawables(
  layout: OfficeLayout,
  offsetX: number,
  offsetY: number,
  zoom: number,
): Array<{ zY: number; draw: (ctx: CanvasRenderingContext2D) => void }> {
  if (!layout.zones) return []
  const size = Math.max(7, Math.round(5.5 * zoom))
  const font = `bold ${size}px monospace`
  const shadow = Math.max(1, Math.round(zoom / 2))
  return zoneLabelSpots(layout).map((spot) => ({
    zY: spot.y - TILE_SIZE / 2 + 0.25,
    draw: (ctx: CanvasRenderingContext2D) => {
      const x = Math.round(offsetX + spot.x * zoom)
      const y = Math.round(offsetY + spot.y * zoom)
      const text = ZONE_LABELS[spot.kind]
      ctx.save()
      ctx.font = font
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
      ctx.fillText(text, x + shadow, y + shadow)
      ctx.fillStyle = 'rgba(255, 248, 230, 0.62)'
      ctx.fillText(text, x, y)
      ctx.restore()
    },
  }))
}
