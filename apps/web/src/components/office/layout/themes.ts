// Office themes (Phase 3). The default floor plan is bundled; extra themes are small
// data-only JSON files fetched at runtime from /themes/ (nothing in the JS bundle).
//
//   /themes/index.json      [{ "id", "name", "file", "swatch"?: ["#hex", …] }]
//   /themes/<file>.json     { "version": 1, "kind": "palette", "walls"?: FloorColor,
//                             "doors"?: FloorColor, "floors"?: { <zone>: FloorColor } }
//
// A palette theme recolors the built-in plan zone by zone. Local room ZIPs (/offices/,
// never shipped) still load through roomZipLoader.

import { TileType } from '../types'
import type { FloorColor, OfficeLayout, ZoneKind } from '../types'
import { createDefaultLayout } from './layoutSerializer'
import { isZoneKind } from './zones'

export const THEMES_BASE = '/themes'
/** Id of the bundled default office in the switcher and in localStorage */
export const BUILTIN_THEME_ID = 'builtin'

export interface ThemeIndexEntry {
  id: string
  name: string
  file: string
  /** A few colors for the switcher's preview tile */
  swatch?: string[]
}

export interface PaletteTheme {
  version: 1
  kind: 'palette'
  walls?: FloorColor
  doors?: FloorColor
  floors?: Partial<Record<ZoneKind, FloorColor>>
}

function num(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : null
}

/** A FloorColor from untrusted JSON, clamped to the editor's ranges; null when malformed. */
export function parseFloorColor(v: unknown): FloorColor | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const h = num(o.h, -180, 360)
  const s = num(o.s, -100, 100)
  const b = num(o.b, -100, 100)
  const c = num(o.c ?? 0, -100, 100)
  if (h === null || s === null || b === null || c === null) return null
  return { h, s, b, c, ...(o.colorize === true ? { colorize: true } : {}) }
}

/** Validate a palette theme file (data only: unknown keys are ignored). */
export function parsePaletteTheme(json: unknown): PaletteTheme | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  if (o.version !== 1 || o.kind !== 'palette') return null
  const theme: PaletteTheme = { version: 1, kind: 'palette' }
  const walls = parseFloorColor(o.walls)
  if (walls) theme.walls = walls
  const doors = parseFloorColor(o.doors)
  if (doors) theme.doors = doors
  if (o.floors && typeof o.floors === 'object') {
    const floors: Partial<Record<ZoneKind, FloorColor>> = {}
    for (const [k, v] of Object.entries(o.floors as Record<string, unknown>)) {
      const color = parseFloorColor(v)
      if (isZoneKind(k) && color) floors[k] = color
    }
    theme.floors = floors
  }
  return theme
}

/** Recolor a zoned layout: floors by zone, walls, and floor tiles outside zones (doorways). */
export function applyPaletteTheme(layout: OfficeLayout, theme: PaletteTheme): OfficeLayout {
  const colors = [...(layout.tileColors ?? new Array(layout.tiles.length).fill(null))]
  layout.tiles.forEach((tile, i) => {
    if (tile === TileType.VOID) return
    if (tile === TileType.WALL) {
      if (theme.walls) colors[i] = theme.walls
      return
    }
    const zone = layout.zones?.[i] ?? null
    const color = zone ? theme.floors?.[zone] : theme.doors
    if (color) colors[i] = color
  })
  return { ...layout, tileColors: colors }
}

/**
 * Validate /themes/index.json: well-formed entries only, each `file` a plain `*.json` name
 * inside /themes/ (no paths), first entry wins for a repeated id.
 */
export function parseThemeIndex(data: unknown): ThemeIndexEntry[] {
  if (!Array.isArray(data)) return []
  const seen = new Set<string>()
  return data.filter((e): e is ThemeIndexEntry => {
    if (!e || typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.file !== 'string') return false
    if (!/^[\w.-]+\.json$/.test(e.file) || e.id === BUILTIN_THEME_ID || seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })
}

/** The theme list shipped in /themes/index.json (empty when missing or malformed). */
export async function loadThemeIndex(): Promise<ThemeIndexEntry[]> {
  try {
    const res = await fetch(`${THEMES_BASE}/index.json`)
    if (!res.ok) return []
    return parseThemeIndex(await res.json())
  } catch {
    return []
  }
}

/** The built-in plan in a theme's colors, or null when the theme cannot be loaded. */
export async function loadThemeLayout(entry: ThemeIndexEntry): Promise<OfficeLayout | null> {
  try {
    const res = await fetch(`${THEMES_BASE}/${entry.file}`)
    if (!res.ok) return null
    const theme = parsePaletteTheme(await res.json())
    return theme ? applyPaletteTheme(createDefaultLayout(), theme) : null
  } catch {
    return null
  }
}
