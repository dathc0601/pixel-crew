// The Boss's look (Phase 3): a navy suit with a white collar and a red tie, recolored at
// runtime from a regular character sheet. Original work for Pixel Crew (MIT).

import { Direction } from '../types'
import type { SpriteData } from '../types'
import { getCharacterSprites, type CharacterSprites } from './spriteData'

/** Rows of a 16×32 character frame that hold the jacket and the trousers */
const TORSO_ROWS: [number, number] = [17, 23]
const LEG_ROWS: [number, number] = [24, 26]
const SUIT = ['#1b2338', '#25304d', '#334266']
const TROUSERS = ['#161c2c', '#1f2740']
const TIE = '#c0392b'
const TIE_DARK = '#8e2a20'
const COLLAR = '#f4f1ea'

function rgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const isSkin = ([r, g, b]: [number, number, number]) => r > 170 && g > 110 && r > b + 25 && r >= g
const isOutline = ([r, g, b]: [number, number, number]) => r + g + b < 60

function shade(c: [number, number, number], palette: string[]): string {
  const lum = (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255
  return palette[Math.min(palette.length - 1, Math.floor(lum * palette.length * 1.4))]
}

/** Recolor one frame; `front` frames also get the collar and the tie. */
export function suitUp(sprite: SpriteData, front: boolean): SpriteData {
  const out = sprite.map((row) => [...row])
  for (let y = TORSO_ROWS[0]; y <= LEG_ROWS[1] && y < out.length; y++) {
    const palette = y <= TORSO_ROWS[1] ? SUIT : TROUSERS
    for (let x = 0; x < out[y].length; x++) {
      const c = rgb(out[y][x])
      if (!c || isSkin(c) || isOutline(c)) continue
      out[y][x] = shade(c, palette)
    }
  }
  if (front) {
    const [top] = TORSO_ROWS
    // Center columns of the body (frames are 16 px wide, the body is centered on 7.5)
    if (out[top]?.[7]) { out[top][7] = COLLAR; out[top][8] = COLLAR }
    for (let y = top + 1; y <= top + 4; y++) {
      if (!out[y]?.[7]) continue
      out[y][7] = y === top + 1 ? TIE_DARK : TIE
      if (y <= top + 3) out[y][8] = TIE
    }
  }
  return out
}

/** Keyed by the base sheet, so reloaded character sheets get a fresh suit */
const cache = new WeakMap<CharacterSprites, CharacterSprites>()

/** The Boss's sprites: the given character sheet in a suit. */
export function getBossSprites(palette: number): CharacterSprites | null {
  const base = getCharacterSprites(palette, 0)
  if (!base) return null
  const hit = cache.get(base)
  if (hit) return hit
  const dirs = [Direction.DOWN, Direction.UP, Direction.RIGHT, Direction.LEFT] as const
  const map4 = (d: Direction, a: [SpriteData, SpriteData, SpriteData, SpriteData]) =>
    a.map((s) => suitUp(s, d === Direction.DOWN)) as [SpriteData, SpriteData, SpriteData, SpriteData]
  const map2 = (d: Direction, a: [SpriteData, SpriteData]) => a.map((s) => suitUp(s, d === Direction.DOWN)) as [SpriteData, SpriteData]
  const sprites = {
    walk: Object.fromEntries(dirs.map((d) => [d, map4(d, base.walk[d])])),
    typing: Object.fromEntries(dirs.map((d) => [d, map2(d, base.typing[d])])),
    reading: Object.fromEntries(dirs.map((d) => [d, map2(d, base.reading[d])])),
  } as unknown as CharacterSprites
  cache.set(base, sprites)
  return sprites
}
