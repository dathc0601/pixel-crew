// The default floor plan (Phase 3): a small company that reads at a glance.
//
//   ┌──────────┬──────────────────────────────┐
//   │ BOSS     │ LEAD  [task board]  windows  │   Boss room: big desk, chair, cabinets,
//   │ (desk)   D  Lead desk   Reviewer desk  │   windows, plants, a door (D) to the Lead area.
//   │          │ ─ ─ cabinets ─ ─             │
//   ├──────────┤ DEV TEAM                     │   Dev room: Lead area on top, dev desks
//   │ PANTRY   │  [] [] [] []    meeting nook │   (one monitor each, up to 8) below.
//   │ coffee   D  [] [] [] []                 │   Pantry: coffee, cooler, fridge, armchairs.
//   │ armchairs│  lockers                     │
//   └──────────┴──────────────────────────────┘
//
// Row 0 is empty headroom so the top wall (drawn 32 px tall) and its windows fit on screen.

import { TileType } from '../types'
import type { FloorColor, OfficeLayout, PlacedFurniture, TileType as TileTypeVal, ZoneKind } from '../types'

/** Wall paint: a muted blue-gray, darker than the floors so rooms read as rooms */
const WALL_COLOR: FloorColor = { h: 214, s: 18, b: -42, c: 0 }

export const OFFICE_COLS = 26
export const OFFICE_ROWS = 23

/** Furniture type ids of the Phase 3 art set (see furnitureCatalog.ts) */
export const ART = {
  DESK: 'desk',
  BOOKSHELF: 'bookshelf',
  PLANT: 'plant',
  COOLER: 'cooler',
  BOSS_DESK: 'boss-desk',
  BOSS_CHAIR: 'boss-chair',
  OFFICE_CHAIR: 'office-chair',
  ARMCHAIR: 'armchair',
  MONITOR: 'monitor',
  MONITOR_BACK: 'monitor-back',
  CABINET: 'cabinet',
  LOCKER: 'locker',
  FRIDGE: 'fridge',
  COFFEE_COUNTER: 'coffee-counter',
  ROUND_TABLE: 'round-table',
  PAPER_STACK: 'paper-stack',
  DOC_TRAY: 'doc-tray',
  WINDOW: 'window',
  TASK_BOARD: 'task-board',
  DOOR_V: 'door-v',
  DOOR_JAMB: 'door-jamb',
  PLANT_TALL: 'plant-tall',
  RUG: 'rug',
} as const

const FLOORS: Record<ZoneKind | 'door' | 'hall', { tile: TileTypeVal; color: FloorColor }> = {
  boss_room: { tile: TileType.FLOOR_3, color: { h: 22, s: 48, b: -8, c: 10, colorize: true } },
  lead_area: { tile: TileType.FLOOR_4, color: { h: 218, s: 32, b: 2, c: 0, colorize: true } },
  dev_area: { tile: TileType.FLOOR_1, color: { h: 34, s: 30, b: 16, c: 0, colorize: true } },
  meeting: { tile: TileType.FLOOR_4, color: { h: 150, s: 22, b: 4, c: 0, colorize: true } },
  pantry: { tile: TileType.FLOOR_5, color: { h: 188, s: 18, b: 22, c: 0, colorize: true } },
  door: { tile: TileType.FLOOR_2, color: { h: 30, s: 40, b: 6, c: 0, colorize: true } },
  hall: { tile: TileType.FLOOR_1, color: { h: 34, s: 30, b: 16, c: 0, colorize: true } },
}

/** Zone rectangles (inclusive tile ranges). Later entries win where they overlap. */
const ZONE_RECTS: Array<{ kind: ZoneKind; c0: number; r0: number; c1: number; r1: number }> = [
  { kind: 'boss_room', c0: 1, r0: 2, c1: 8, r1: 10 },
  { kind: 'pantry', c0: 1, r0: 12, c1: 8, r1: 21 },
  { kind: 'lead_area', c0: 10, r0: 2, c1: 24, r1: 8 },
  { kind: 'dev_area', c0: 10, r0: 9, c1: 24, r1: 21 },
  { kind: 'meeting', c0: 22, r0: 11, c1: 24, r1: 15 },
]

/**
 * Doorways: gaps in the side walls. Each gap is two tiles tall: the lower tile sits under
 * the next wall piece's top (3/4 view), so it is blocked by an invisible door jamb and
 * everyone walks through the upper, visible tile.
 */
export const OFFICE_DOORS = [
  { col: 9, row: 6 }, // Boss room → Lead area
  { col: 9, row: 16 }, // Pantry → Dev room
]

export function createOfficeLayout(): OfficeLayout {
  const COLS = OFFICE_COLS
  const ROWS = OFFICE_ROWS
  const tiles: TileTypeVal[] = new Array(COLS * ROWS).fill(TileType.VOID)
  const tileColors: Array<FloorColor | null> = new Array(COLS * ROWS).fill(null)
  const zones: Array<ZoneKind | null> = new Array(COLS * ROWS).fill(null)
  const at = (c: number, r: number) => r * COLS + c
  const floor = (c: number, r: number, kind: keyof typeof FLOORS) => {
    tiles[at(c, r)] = FLOORS[kind].tile
    tileColors[at(c, r)] = FLOORS[kind].color
  }
  const wall = (c: number, r: number) => {
    tiles[at(c, r)] = TileType.WALL
    tileColors[at(c, r)] = WALL_COLOR
  }

  // Shell: outer walls on rows 1..22, cols 0..25
  for (let r = 1; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const outer = r === 1 || r === ROWS - 1 || c === 0 || c === COLS - 1
      if (outer) wall(c, r)
      else floor(c, r, 'hall')
    }
  }
  // Inner walls: the Boss room / pantry column and the wall between them
  for (let r = 1; r < ROWS; r++) wall(9, r)
  for (let c = 0; c <= 9; c++) wall(c, 11)
  for (const z of ZONE_RECTS) {
    for (let r = z.r0; r <= z.r1; r++) {
      for (let c = z.c0; c <= z.c1; c++) {
        if (tiles[at(c, r)] === TileType.WALL) continue
        floor(c, r, z.kind)
        zones[at(c, r)] = z.kind
      }
    }
  }
  for (const d of OFFICE_DOORS) {
    floor(d.col, d.row, 'door')
    floor(d.col, d.row + 1, 'door')
  }

  const f: PlacedFurniture[] = []
  const put = (uid: string, type: string, col: number, row: number) => f.push({ uid, type, col, row })

  // ── Boss room (uids start with "boss": the chair is the Boss's seat) ──
  put('boss-rug', ART.RUG, 2, 4)
  put('boss-desk', ART.BOSS_DESK, 3, 4)
  put('boss-chair', ART.BOSS_CHAIR, 4, 3)
  put('boss-monitor', ART.MONITOR_BACK, 3, 4)
  put('boss-papers', ART.PAPER_STACK, 5, 5)
  put('boss-window-1', ART.WINDOW, 1, 0)
  put('boss-window-2', ART.WINDOW, 6, 0)
  put('boss-cabinet-1', ART.CABINET, 1, 2)
  put('boss-cabinet-2', ART.CABINET, 8, 2)
  put('boss-shelf', ART.BOOKSHELF, 7, 2)
  put('boss-plant-1', ART.PLANT_TALL, 1, 9)
  put('boss-plant-2', ART.PLANT, 8, 10)
  put('boss-door', ART.DOOR_V, 9, 6)
  put('boss-door-jamb', ART.DOOR_JAMB, 9, 7)

  // ── Lead area: the Lead's desk faces the task board; the reviewer's desk beside it ──
  put('task-board', ART.TASK_BOARD, 12, 0)
  put('lead-desk', ART.DESK, 12, 4)
  put('lead-chair', ART.OFFICE_CHAIR, 12, 6)
  put('lead-monitor', ART.MONITOR, 12, 4)
  put('lead-papers', ART.PAPER_STACK, 13, 5)
  put('review-desk', ART.DESK, 18, 4)
  put('review-chair', ART.OFFICE_CHAIR, 18, 6)
  put('review-monitor', ART.MONITOR, 18, 4)
  put('review-tray', ART.DOC_TRAY, 19, 5)
  put('lead-window-1', ART.WINDOW, 16, 0)
  put('lead-window-2', ART.WINDOW, 20, 0)
  put('lead-cabinet-1', ART.CABINET, 22, 2)
  put('lead-cabinet-2', ART.CABINET, 23, 2)
  put('lead-plant-1', ART.PLANT_TALL, 10, 2)
  put('lead-plant-2', ART.PLANT_TALL, 24, 2)
  // Low divider between the Lead area and the dev desks (gaps left and right)
  put('divider-1', ART.CABINET, 15, 7)
  put('divider-2', ART.CABINET, 16, 7)
  put('divider-3', ART.CABINET, 17, 7)
  put('divider-plant-1', ART.PLANT, 10, 8)
  put('divider-plant-2', ART.PLANT, 24, 8)

  // ── Dev desks: 2 rows × 4, filled in reading order (one monitor each) ──
  let n = 0
  for (const row of [10, 15]) {
    for (const col of [11, 14, 17, 20]) {
      n++
      put(`dev-desk-${n}`, ART.DESK, col, row)
      put(`dev-chair-${n}`, ART.OFFICE_CHAIR, col, row + 2)
      put(`dev-monitor-${n}`, ART.MONITOR, col, row)
      if (n % 2 === 1) put(`dev-papers-${n}`, ART.PAPER_STACK, col + 1, row + 1)
    }
  }
  // Meeting nook (rest seats) and staff lockers
  put('meet-table', ART.ROUND_TABLE, 22, 12)
  put('meet-chair-1', ART.ARMCHAIR, 24, 12)
  put('meet-chair-2', ART.ARMCHAIR, 24, 13)
  for (const [i, col] of [20, 21, 22, 23].entries()) put(`locker-${i + 1}`, ART.LOCKER, col, 20)
  put('dev-cabinet', ART.CABINET, 24, 20)
  put('dev-plant-1', ART.PLANT_TALL, 10, 20)
  put('dev-plant-2', ART.PLANT, 24, 9)

  // ── Pantry ──
  put('pantry-counter', ART.COFFEE_COUNTER, 1, 12)
  put('pantry-cooler', ART.COOLER, 4, 12)
  put('pantry-fridge', ART.FRIDGE, 6, 12)
  put('pantry-table', ART.ROUND_TABLE, 3, 16)
  put('pantry-chair-1', ART.ARMCHAIR, 2, 16)
  put('pantry-chair-2', ART.ARMCHAIR, 5, 17)
  put('pantry-chair-3', ART.ARMCHAIR, 3, 20)
  put('pantry-chair-4', ART.ARMCHAIR, 5, 20)
  put('pantry-plant-1', ART.PLANT_TALL, 1, 20)
  put('pantry-plant-2', ART.PLANT, 8, 12)
  put('pantry-door', ART.DOOR_V, 9, 16)
  put('pantry-door-jamb', ART.DOOR_JAMB, 9, 17)

  return { version: 2, cols: COLS, rows: ROWS, tiles, tileColors, furniture: f, zones }
}
