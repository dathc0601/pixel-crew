// Original Pixel Crew office art (Phase 3), drawn in code for this project: MIT like the
// rest of the repository. No external images. Each sprite is a SpriteData grid (16 px per
// tile); '' is transparent and 8-digit hex colors carry alpha (monitor glow).

import type { SpriteData } from '../types'

/** Tiny raster helper: rectangles and pixels on a w×h grid of hex colors. */
class Px {
  readonly g: string[][]
  constructor(readonly w: number, readonly h: number) {
    this.g = Array.from({ length: h }, () => new Array<string>(w).fill(''))
  }
  px(x: number, y: number, c: string): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y][x] = c
    return this
  }
  rect(x: number, y: number, w: number, h: number, c: string): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c)
    return this
  }
  /** 1 px frame */
  box(x: number, y: number, w: number, h: number, c: string): this {
    this.rect(x, y, w, 1, c).rect(x, y + h - 1, w, 1, c).rect(x, y, 1, h, c).rect(x + w - 1, y, 1, h, c)
    return this
  }
  hline(x: number, y: number, w: number, c: string): this { return this.rect(x, y, w, 1, c) }
  vline(x: number, y: number, h: number, c: string): this { return this.rect(x, y, 1, h, c) }
  done(): SpriteData { return this.g }
}

// ── Desks ───────────────────────────────────────────────────────

/** The Boss's executive desk: 48×32 (3×2 tiles), dark mahogany, gold trim, green leather mat. */
export const BOSS_DESK_SPRITE: SpriteData = (() => {
  const p = new Px(48, 32)
  const top = '#7a2e1f', topHi = '#93402b', edge = '#4a170f', face = '#5c1d12', faceHi = '#6e2617'
  const gold = '#d9a21b', mat = '#2f6b45', matHi = '#3f8459', shadow = '#00000055'
  p.rect(1, 2, 46, 17, top).hline(2, 3, 44, topHi).box(1, 2, 46, 17, edge)
  p.rect(14, 6, 20, 10, mat).box(14, 6, 20, 10, '#1f4a30').hline(15, 7, 18, matHi)
  // Front face with drawers on both pedestals
  p.rect(1, 19, 46, 10, face).hline(1, 19, 46, gold).box(1, 19, 46, 10, edge)
  for (const x of [3, 33]) {
    p.rect(x, 21, 12, 3, faceHi).box(x, 21, 12, 3, edge).px(x + 6, 22, gold)
    p.rect(x, 25, 12, 3, faceHi).box(x, 25, 12, 3, edge).px(x + 6, 26, gold)
  }
  p.rect(16, 21, 16, 6, '#3c120b')
  p.rect(2, 29, 44, 2, shadow)
  return p.done()
})()

/** Kitchen counter: 32×32 (2×2, top row is background), cupboard doors below. */
export const COUNTER_SPRITE: SpriteData = (() => {
  const p = new Px(32, 32)
  const top = '#d8d2c4', topHi = '#ece7db', edge = '#8f8676', door = '#b9875a', doorD = '#8a5f3b'
  p.rect(0, 10, 32, 8, top).hline(0, 10, 32, topHi).box(0, 10, 32, 8, edge)
  p.rect(0, 18, 32, 12, door).box(0, 18, 32, 12, doorD).vline(16, 18, 12, doorD)
  p.px(13, 23, '#e8d9b0').px(19, 23, '#e8d9b0')
  p.rect(1, 30, 30, 2, '#00000044')
  return p.done()
})()

/** Pantry round table: 32×32 (2×2), not a desk (no work seat). */
export const ROUND_TABLE_SPRITE: SpriteData = (() => {
  const p = new Px(32, 32)
  const top = '#c79a62', hi = '#ddb47c', edge = '#80592e'
  for (let y = 0; y < 22; y++) {
    const half = Math.round(Math.sqrt(Math.max(0, 121 - (y - 11) ** 2)) * 1.25)
    p.rect(16 - half, 3 + y, half * 2, 1, y < 4 ? hi : top)
    p.px(16 - half, 3 + y, edge).px(15 + half, 3 + y, edge)
  }
  p.hline(4, 25, 24, edge)
  p.rect(14, 26, 4, 4, '#5e4022').rect(8, 30, 16, 1, '#00000044')
  return p.done()
})()

// ── Electronics ─────────────────────────────────────────────────

function monitor(on: boolean): SpriteData {
  // 32×16 so it sits centered on a 2-tile desk; screen faces the viewer (dev seen from behind)
  const p = new Px(32, 16)
  const bezel = '#2b2d33', bezelHi = '#43464f', stand = '#5b5e66'
  if (on) {
    // Soft glow spilling onto the desk around the screen
    p.rect(6, 0, 20, 14, '#8fe3ff22').rect(8, 1, 16, 13, '#8fe3ff33')
  }
  p.rect(9, 1, 14, 10, bezel).hline(9, 1, 14, bezelHi)
  if (on) {
    p.rect(10, 2, 12, 8, '#1d5fa8')
    p.hline(11, 3, 5, '#9df0ff').hline(17, 3, 3, '#ffe08a')
    p.hline(12, 5, 7, '#c6f7ff').hline(12, 7, 4, '#9df0ff').hline(17, 7, 3, '#ff9fd0')
    p.hline(11, 9, 2, '#ffffff')
  } else {
    p.rect(10, 2, 12, 8, '#141a22').px(11, 3, '#2c3644').px(12, 3, '#2c3644').px(11, 4, '#2c3644')
  }
  p.rect(15, 11, 2, 2, stand).rect(12, 13, 8, 1, stand).rect(12, 14, 8, 1, '#00000044')
  // Keyboard in front of the screen
  p.rect(10, 15, 12, 1, on ? '#d7dde8' : '#9aa1ad')
  return p.done()
}
export const MONITOR_OFF_SPRITE = monitor(false)
export const MONITOR_ON_SPRITE = monitor(true)

/** Back of a monitor (for desks whose owner faces the viewer): 32×16. */
export const MONITOR_BACK_SPRITE: SpriteData = (() => {
  const p = new Px(32, 16)
  p.rect(9, 1, 14, 9, '#3a3d45').box(9, 1, 14, 9, '#24262b').rect(13, 3, 6, 4, '#4a4e58')
  p.rect(15, 10, 2, 3, '#5b5e66').rect(12, 13, 8, 1, '#5b5e66')
  return p.done()
})()

/** Coffee machine: 16×16, sits on the counter. */
export const COFFEE_MACHINE_SPRITE: SpriteData = (() => {
  const p = new Px(16, 16)
  p.rect(3, 1, 10, 12, '#303238').box(3, 1, 10, 12, '#1a1b1f').rect(5, 3, 6, 3, '#59606b')
  p.px(6, 4, '#ff5b4a').px(9, 4, '#6cff8d')
  p.rect(6, 8, 4, 4, '#0e0f12').rect(7, 10, 2, 2, '#f2efe6').px(7, 9, '#6b3e1e')
  p.rect(2, 13, 12, 2, '#1a1b1f')
  return p.done()
})()

// ── Storage ─────────────────────────────────────────────────────

/** Filing cabinet: 16×32 (1×2, top row background), three drawers with paper tabs. */
export const CABINET_SPRITE: SpriteData = (() => {
  const p = new Px(16, 32)
  const body = '#8b939e', hi = '#a6aeb8', edge = '#5a616b'
  p.rect(2, 6, 12, 24, body).hline(2, 6, 12, hi).box(2, 6, 12, 24, edge)
  for (const y of [9, 16, 23]) {
    p.box(3, y, 10, 6, edge).hline(6, y + 2, 4, '#d9dde2')
    p.px(5, y - 1, '#f4f1e6').px(6, y - 1, '#f4f1e6')
  }
  p.rect(2, 30, 12, 2, '#00000044')
  return p.done()
})()

/** Staff locker: 16×32 (1×2, top row background), vents and a handle. */
export function lockerSprite(body: string): SpriteData {
  const p = new Px(16, 32)
  const edge = '#2e3a4a'
  p.rect(1, 3, 14, 27, body).box(1, 3, 14, 27, edge).vline(8, 3, 27, edge)
  for (const x of [3, 10]) {
    for (const y of [6, 8, 10]) p.hline(x, y, 3, edge)
    p.rect(x + 3, 17, 1, 3, '#d9dde2')
  }
  p.rect(1, 30, 14, 2, '#00000044')
  return p.done()
}
export const LOCKER_SPRITE = lockerSprite('#5b7fa6')

/** Fridge: 16×32 (1×2, top row background). */
export const FRIDGE_SPRITE: SpriteData = (() => {
  const p = new Px(16, 32)
  p.rect(2, 2, 12, 28, '#e9eef2').box(2, 2, 12, 28, '#9aa6b0').hline(2, 12, 12, '#9aa6b0')
  p.rect(11, 5, 1, 4, '#9aa6b0').rect(11, 15, 1, 6, '#9aa6b0').px(5, 6, '#ff7a59')
  p.rect(2, 30, 12, 2, '#00000044')
  return p.done()
})()

// ── Paper ───────────────────────────────────────────────────────

/** Two stacks of documents, one clipped: 16×16, placeable on desks. */
export const PAPER_STACK_SPRITE: SpriteData = (() => {
  const p = new Px(16, 16)
  const paper = '#f6f3e8', line = '#b9b4a6', edge = '#8f8a7c'
  p.rect(1, 7, 7, 7, paper).box(1, 7, 7, 7, edge).hline(2, 9, 5, line).hline(2, 11, 4, line)
  p.hline(1, 14, 7, edge).hline(1, 15, 7, '#00000033')
  p.rect(8, 4, 7, 9, paper).box(8, 4, 7, 9, edge).hline(9, 6, 5, line).hline(9, 8, 5, line).hline(9, 10, 3, line)
  p.hline(8, 13, 7, edge).hline(8, 14, 7, edge).rect(10, 3, 3, 2, '#c33b2e')
  return p.done()
})()

/** Document tray with folders: 16×16, placeable on desks or cabinets. */
export const DOC_TRAY_SPRITE: SpriteData = (() => {
  const p = new Px(16, 16)
  p.rect(2, 6, 12, 2, '#e3b341').rect(2, 8, 12, 2, '#4f8fd6').rect(2, 10, 12, 2, '#f6f3e8')
  p.box(1, 5, 14, 9, '#4b4f57').hline(1, 14, 14, '#00000033')
  return p.done()
})()

// ── Chairs ──────────────────────────────────────────────────────

/** Office chair seen from behind (dev seats face the desk): 16×16. */
export const OFFICE_CHAIR_SPRITE: SpriteData = (() => {
  const p = new Px(16, 16)
  const seat = '#3c5a8a', hi = '#5576ab', dark = '#24385a'
  p.rect(4, 3, 8, 7, seat).hline(4, 3, 8, hi).box(4, 3, 8, 7, dark)
  p.rect(3, 9, 10, 2, dark)
  p.rect(7, 11, 2, 2, '#4a4d55').hline(4, 13, 8, '#4a4d55').px(4, 14, '#2a2c31').px(11, 14, '#2a2c31').px(7, 14, '#2a2c31')
  return p.done()
})()

/** The Boss's high-back leather chair: 16×16. */
export const BOSS_CHAIR_SPRITE: SpriteData = (() => {
  const p = new Px(16, 16)
  const leather = '#4a2a1a', hi = '#6b3e27', dark = '#2c160c'
  p.rect(3, 0, 10, 12, leather).box(3, 0, 10, 12, dark).hline(4, 1, 8, hi)
  p.vline(6, 3, 6, dark).vline(9, 3, 6, dark).px(7, 5, '#d9a21b').px(8, 5, '#d9a21b')
  p.rect(2, 10, 12, 2, dark)
  p.rect(7, 12, 2, 2, '#4a4d55').hline(4, 14, 8, '#4a4d55')
  return p.done()
})()

/** Pantry armchair (a rest seat): 16×16. */
export const ARMCHAIR_SPRITE: SpriteData = (() => {
  const p = new Px(16, 16)
  const fab = '#b5553c', hi = '#cf6d52', dark = '#7d3423'
  p.rect(2, 2, 12, 12, fab).box(2, 2, 12, 12, dark).rect(4, 4, 8, 7, hi)
  p.rect(2, 2, 3, 12, dark).rect(11, 2, 3, 12, dark).rect(2, 14, 12, 1, '#00000044')
  return p.done()
})()

// ── Walls and doors ─────────────────────────────────────────────

/** Window for the outer wall: 32×32 (2×2, bottom row sits on the wall tile). */
export const WINDOW_SPRITE: SpriteData = (() => {
  const p = new Px(32, 32)
  const frame = '#e8e2d4', frameD = '#a79f8f', sky = '#8fd0f5', skyD = '#6ab7e6'
  p.rect(3, 6, 26, 20, frame).box(3, 6, 26, 20, frameD)
  p.rect(5, 8, 10, 16, sky).rect(17, 8, 10, 16, sky)
  p.rect(5, 18, 10, 6, skyD).rect(17, 18, 10, 6, skyD)
  p.rect(7, 11, 5, 2, '#ffffff').rect(9, 10, 3, 1, '#ffffff').rect(20, 13, 4, 1, '#ffffff')
  p.px(6, 9, '#d9f2ff').px(18, 9, '#d9f2ff')
  p.rect(2, 26, 28, 2, frame).hline(2, 27, 28, frameD)
  return p.done()
})()

/** The task board on the Lead's wall: 48×32 (3×2, bottom row on the wall). Queue papers are drawn on top. */
export const TASK_BOARD_SPRITE: SpriteData = (() => {
  const p = new Px(48, 32)
  const frame = '#6b4423', cork = '#c8955a', corkD = '#b5824a'
  p.rect(2, 3, 44, 25, frame).rect(4, 8, 40, 18, cork)
  for (let y = 9; y < 26; y += 3) for (let x = 5 + (y % 2); x < 44; x += 5) p.px(x, y, corkD)
  // Header strip "TASKS"
  p.rect(14, 4, 20, 3, '#f2d27a')
  const letters = [16, 19, 22, 25, 28, 31]
  for (const x of letters.slice(0, 5)) p.rect(x, 5, 2, 1, '#6b4423')
  return p.done()
})()

/** Doorway in a vertical wall: 16×16 floor piece (threshold, open door leaf against the wall). */
export const DOOR_V_SPRITE: SpriteData = (() => {
  const p = new Px(16, 16)
  p.rect(0, 0, 16, 16, '#9b7650').rect(0, 0, 16, 1, '#6f5233').rect(0, 15, 16, 1, '#6f5233')
  for (const y of [4, 8, 12]) p.hline(0, y, 16, '#86643f')
  // Door leaf swung open along the top jamb
  p.rect(1, 0, 13, 3, '#c08a4e').hline(1, 2, 13, '#7d5329').px(11, 1, '#f0c75e')
  return p.done()
})()

/** Doorway in a horizontal wall: 16×32 frame (posts + lintel) drawn over the gap. */
export const DOOR_H_SPRITE: SpriteData = (() => {
  const p = new Px(16, 32)
  const wood = '#8a5f3b', woodD = '#5e3e24'
  p.rect(0, 0, 16, 5, wood).hline(0, 4, 16, woodD)
  p.rect(0, 0, 2, 32, wood).rect(14, 0, 2, 32, wood).vline(1, 5, 27, woodD).vline(14, 5, 27, woodD)
  p.rect(2, 26, 12, 6, '#9b7650')
  return p.done()
})()

// ── Decor ───────────────────────────────────────────────────────

/** Tall leafy plant: 16×32 (1×2, top row background). */
export const PLANT_TALL_SPRITE: SpriteData = (() => {
  const p = new Px(16, 32)
  const g1 = '#2f7d32', g2 = '#45a049', g3 = '#1f5c22'
  const leaves: Array<[number, number, number, number, string]> = [
    [6, 2, 4, 6, g2], [3, 5, 4, 6, g1], [9, 5, 4, 6, g1], [2, 10, 5, 5, g2], [9, 10, 5, 5, g2],
    [5, 8, 6, 9, g1], [6, 14, 4, 6, g3], [4, 16, 3, 4, g2], [9, 16, 3, 4, g2],
  ]
  for (const [x, y, w, h, c] of leaves) p.rect(x, y, w, h, c)
  p.px(7, 3, '#7cc47f').px(4, 7, '#7cc47f').px(11, 7, '#7cc47f')
  p.rect(4, 21, 8, 8, '#c4673f').hline(3, 21, 10, '#d9824f').hline(4, 28, 8, '#8e4528')
  p.rect(4, 29, 8, 2, '#00000044')
  return p.done()
})()

/** Rug under the Boss's desk: 64×48 (4×3), never blocks walking. */
export const RUG_SPRITE: SpriteData = (() => {
  const p = new Px(64, 48)
  p.rect(0, 0, 64, 48, '#7b2533').box(0, 0, 64, 48, '#d9a21b').box(3, 3, 58, 42, '#d9a21b')
  p.rect(6, 6, 52, 36, '#8f3140')
  for (let i = 0; i < 6; i++) p.rect(10 + i * 8, 22, 4, 4, '#b8873a')
  return p.done()
})()

/** Invisible 16×16 piece: blocks a tile without drawing anything (door jambs). */
export const EMPTY_TILE_SPRITE: SpriteData = new Px(16, 16).done()
