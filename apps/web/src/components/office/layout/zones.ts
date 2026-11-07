// Zones (layout v2): named areas of the floor plan and the seat rules that follow them.
//   Boss      → boss_room (the chair at the Boss's desk)
//   Lead      → the first lead_area desk
//   Reviewer  → another lead_area desk, else the last dev_area desk
//   Devs      → dev_area desks in reading order (top row left to right, then the next row)
// Layouts without a zone map keep the old rule: any free work seat.

import { ZONE_KINDS } from '../types'
import type { OfficeLayout, Seat, SeatRole, ZoneKind } from '../types'

export const ZONE_LABELS: Record<ZoneKind, string> = {
  boss_room: 'BOSS',
  lead_area: 'LEAD',
  dev_area: 'DEV TEAM',
  meeting: 'MEETING',
  pantry: 'PANTRY',
}

/** Editor overlay tint per zone (rgba, canvas only) */
export const ZONE_TINTS: Record<ZoneKind, string> = {
  boss_room: 'rgba(232, 176, 64, 0.28)',
  lead_area: 'rgba(90, 140, 255, 0.28)',
  dev_area: 'rgba(80, 200, 120, 0.24)',
  meeting: 'rgba(200, 90, 220, 0.24)',
  pantry: 'rgba(240, 120, 70, 0.24)',
}

export function isZoneKind(v: unknown): v is ZoneKind {
  return typeof v === 'string' && (ZONE_KINDS as readonly string[]).includes(v)
}

export function hasZones(layout: Pick<OfficeLayout, 'zones'>): boolean {
  return !!layout.zones && layout.zones.some((z) => z !== null)
}

export function zoneAt(layout: Pick<OfficeLayout, 'zones' | 'cols' | 'rows'>, col: number, row: number): ZoneKind | null {
  if (!layout.zones || col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return null
  return layout.zones[row * layout.cols + col] ?? null
}

/** Drop unknown zone values and wrong-length maps (old or hand-edited files). */
export function sanitizeZones(layout: OfficeLayout): OfficeLayout {
  if (!layout.zones) return layout
  if (!Array.isArray(layout.zones) || layout.zones.length !== layout.tiles.length) {
    const { zones: _drop, ...rest } = layout
    return rest
  }
  if (layout.zones.every((z) => z === null || isZoneKind(z))) return layout
  return { ...layout, zones: layout.zones.map((z) => (isZoneKind(z) ? z : null)) }
}

/** Paint one tile's zone (null clears it). Returns a new layout (immutable). */
export function paintZone(layout: OfficeLayout, col: number, row: number, zone: ZoneKind | null): OfficeLayout {
  const idx = row * layout.cols + col
  if (col < 0 || row < 0 || col >= layout.cols || idx >= layout.tiles.length) return layout
  const zones = layout.zones && layout.zones.length === layout.tiles.length
    ? [...layout.zones]
    : new Array<ZoneKind | null>(layout.tiles.length).fill(null)
  if (zones[idx] === zone) return layout
  zones[idx] = zone
  return { ...layout, version: 2, zones }
}

const readingOrder = (a: Seat, b: Seat) => (a.seatRow - b.seatRow) || (a.seatCol - b.seatCol)

/**
 * The seat an agent with this role should take, or null when none is free.
 * Boss seats and rest seats (sofas) are never handed out here.
 */
export function pickSeat(seats: Map<string, Seat>, role: SeatRole | undefined, zoned: boolean): string | null {
  const work = [...seats.values()].filter((s) => !s.isRest && !s.isBoss)
  const free = (list: Seat[]) => list.find((s) => !s.assigned)?.uid ?? null
  if (!zoned) return free(work)

  const inZone = (z: ZoneKind) => work.filter((s) => s.zone === z).sort(readingOrder)
  const lead = inZone('lead_area')
  const dev = inZone('dev_area')
  const rest = work.filter((s) => s.zone !== 'lead_area' && s.zone !== 'dev_area').sort(readingOrder)

  switch (role) {
    case 'lead':
      return free(lead) ?? free(dev) ?? free(rest)
    case 'reviewer':
      // The first lead_area desk stays the Lead's
      return free(lead.slice(1)) ?? free([...dev].reverse()) ?? free(rest) ?? free(lead)
    default:
      return free(dev) ?? free(rest) ?? free(lead.slice(1)) ?? free(lead)
  }
}
