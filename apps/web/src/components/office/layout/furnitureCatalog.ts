import { FurnitureType } from '../types'
import type { FurnitureCatalogEntry, SpriteData } from '../types'
import {
  DESK_SQUARE_SPRITE,
  BOOKSHELF_SPRITE,
  PLANT_SPRITE,
  COOLER_SPRITE,
  WHITEBOARD_SPRITE,
  CHAIR_SPRITE,
  PC_SPRITE,
  LAMP_SPRITE,
} from '../sprites/spriteData'
import { TILESET_FURNITURE, type TilesetFurnitureEntry } from '../sprites/assetLoader'
import * as Art from '../sprites/officeArt'

export type FurnitureCategory = 'desks' | 'chairs' | 'storage' | 'decor' | 'electronics' | 'wall' | 'misc'

export interface CatalogEntryWithCategory extends FurnitureCatalogEntry {
  category: FurnitureCategory
}

/** Hardcoded fallback entries (used when tileset isn't loaded yet) */
const FALLBACK_CATALOG: CatalogEntryWithCategory[] = [
  { type: FurnitureType.DESK,       label: 'Desk',       footprintW: 2, footprintH: 2, sprite: DESK_SQUARE_SPRITE,  isDesk: true,  category: 'desks' },
  { type: FurnitureType.BOOKSHELF,  label: 'Bookshelf',  footprintW: 1, footprintH: 2, sprite: BOOKSHELF_SPRITE,    isDesk: false, category: 'storage' },
  { type: FurnitureType.PLANT,      label: 'Plant',      footprintW: 1, footprintH: 1, sprite: PLANT_SPRITE,        isDesk: false, category: 'decor' },
  { type: FurnitureType.COOLER,     label: 'Cooler',     footprintW: 1, footprintH: 1, sprite: COOLER_SPRITE,       isDesk: false, category: 'misc' },
  { type: FurnitureType.WHITEBOARD, label: 'Whiteboard', footprintW: 2, footprintH: 1, sprite: WHITEBOARD_SPRITE,   isDesk: false, category: 'decor' },
  { type: FurnitureType.CHAIR,      label: 'Chair',      footprintW: 1, footprintH: 1, sprite: CHAIR_SPRITE,        isDesk: false, category: 'chairs' },
  { type: FurnitureType.PC,         label: 'PC',         footprintW: 1, footprintH: 1, sprite: PC_SPRITE,           isDesk: false, category: 'electronics' },
  { type: FurnitureType.LAMP,       label: 'Lamp',       footprintW: 1, footprintH: 1, sprite: LAMP_SPRITE,         isDesk: false, category: 'decor' },
]

/** Draw `top` over `base` at (dx, dy): composite sprites such as the coffee counter. */
function overlay(base: SpriteData, top: SpriteData, dx: number, dy: number): SpriteData {
  const out = base.map((row) => [...row])
  top.forEach((row, y) => row.forEach((c, x) => {
    if (c && out[y + dy] && x + dx < out[y + dy].length) out[y + dy][x + dx] = c
  }))
  return out
}

/** Pixel Crew's own office art (Phase 3, sprites/officeArt.ts). Monitors switch on for working agents. */
const OFFICE_ART_CATALOG: CatalogEntryWithCategory[] = [
  { type: 'boss-desk',      label: 'Boss Desk',      footprintW: 3, footprintH: 2, sprite: Art.BOSS_DESK_SPRITE,      isDesk: true,  category: 'desks' },
  { type: 'boss-chair',     label: 'Boss Chair',     footprintW: 1, footprintH: 1, sprite: Art.BOSS_CHAIR_SPRITE,     isDesk: false, category: 'chairs' },
  { type: 'office-chair',   label: 'Office Chair',   footprintW: 1, footprintH: 1, sprite: Art.OFFICE_CHAIR_SPRITE,   isDesk: false, category: 'chairs' },
  { type: 'armchair',       label: 'Armchair',       footprintW: 1, footprintH: 1, sprite: Art.ARMCHAIR_SPRITE,       isDesk: false, category: 'chairs' },
  { type: 'monitor',        label: 'Monitor',        footprintW: 2, footprintH: 1, sprite: Art.MONITOR_OFF_SPRITE,    isDesk: false, category: 'electronics', canPlaceOnSurfaces: true },
  { type: 'monitor-on',     label: 'Monitor (on)',   footprintW: 2, footprintH: 1, sprite: Art.MONITOR_ON_SPRITE,     isDesk: false, category: 'electronics', canPlaceOnSurfaces: true },
  { type: 'monitor-back',   label: 'Monitor (back)', footprintW: 2, footprintH: 1, sprite: Art.MONITOR_BACK_SPRITE,   isDesk: false, category: 'electronics', canPlaceOnSurfaces: true },
  { type: 'cabinet',        label: 'Filing Cabinet', footprintW: 1, footprintH: 2, sprite: Art.CABINET_SPRITE,        isDesk: false, category: 'storage', backgroundTiles: 1 },
  { type: 'locker',         label: 'Locker',         footprintW: 1, footprintH: 2, sprite: Art.LOCKER_SPRITE,         isDesk: false, category: 'storage', backgroundTiles: 1 },
  { type: 'fridge',         label: 'Fridge',         footprintW: 1, footprintH: 2, sprite: Art.FRIDGE_SPRITE,         isDesk: false, category: 'storage' },
  { type: 'coffee-counter', label: 'Coffee Counter', footprintW: 2, footprintH: 2, sprite: overlay(Art.COUNTER_SPRITE, Art.COFFEE_MACHINE_SPRITE, 2, 1), isDesk: false, category: 'misc' },
  { type: 'round-table',    label: 'Round Table',    footprintW: 2, footprintH: 2, sprite: Art.ROUND_TABLE_SPRITE,    isDesk: false, category: 'misc' },
  { type: 'paper-stack',    label: 'Documents',      footprintW: 1, footprintH: 1, sprite: Art.PAPER_STACK_SPRITE,    isDesk: false, category: 'decor', canPlaceOnSurfaces: true },
  { type: 'doc-tray',       label: 'Document Tray',  footprintW: 1, footprintH: 1, sprite: Art.DOC_TRAY_SPRITE,       isDesk: false, category: 'decor', canPlaceOnSurfaces: true },
  { type: 'plant-tall',     label: 'Tall Plant',     footprintW: 1, footprintH: 2, sprite: Art.PLANT_TALL_SPRITE,     isDesk: false, category: 'decor', backgroundTiles: 1 },
  { type: 'rug',            label: 'Rug',            footprintW: 4, footprintH: 3, sprite: Art.RUG_SPRITE,            isDesk: false, category: 'decor', backgroundTiles: 3 },
  { type: 'window',         label: 'Window',         footprintW: 2, footprintH: 2, sprite: Art.WINDOW_SPRITE,         isDesk: false, category: 'wall', canPlaceOnWalls: true },
  { type: 'task-board',     label: 'Task Board',     footprintW: 3, footprintH: 2, sprite: Art.TASK_BOARD_SPRITE,     isDesk: false, category: 'wall', canPlaceOnWalls: true },
  { type: 'door-v',         label: 'Door (side wall)',  footprintW: 1, footprintH: 1, sprite: Art.DOOR_V_SPRITE,      isDesk: false, category: 'misc', backgroundTiles: 1 },
  { type: 'door-jamb',      label: 'Door Jamb (blocks)', footprintW: 1, footprintH: 1, sprite: Art.EMPTY_TILE_SPRITE, isDesk: false, category: 'misc' },
  { type: 'door-h',         label: 'Door (front wall)', footprintW: 1, footprintH: 2, sprite: Art.DOOR_H_SPRITE,      isDesk: false, category: 'misc', backgroundTiles: 2, canPlaceOnWalls: true },
]

/** Full catalog: fallback entries + office art + any tileset entries registered at runtime */
export const FURNITURE_CATALOG: CatalogEntryWithCategory[] = [...FALLBACK_CATALOG, ...OFFICE_ART_CATALOG]

export const FURNITURE_CATEGORIES: Array<{ id: FurnitureCategory; label: string }> = [
  { id: 'desks', label: 'Desks' },
  { id: 'chairs', label: 'Chairs' },
  { id: 'storage', label: 'Storage' },
  { id: 'electronics', label: 'Tech' },
  { id: 'decor', label: 'Decor' },
  { id: 'wall', label: 'Wall' },
  { id: 'misc', label: 'Misc' },
]

// ── Rotation groups ──────────────────────────────────────────────
interface RotationGroup {
  orientations: string[]
  members: Record<string, string>
}
const rotationGroups = new Map<string, RotationGroup>()

// ── State groups ────────────────────────────────────────────────
const stateGroups = new Map<string, string>()
const offToOn = new Map<string, string>()
const onToOff = new Map<string, string>()

/** An on/off furniture pair: the "on" one shows while an agent works at the desk. */
function registerStatePair(offId: string, onId: string): void {
  stateGroups.set(onId, offId)
  stateGroups.set(offId, onId)
  offToOn.set(offId, onId)
  onToOff.set(onId, offId)
}
registerStatePair('monitor', 'monitor-on')

/**
 * Register tileset-loaded sprites into the catalog.
 * Also builds rotation and state groups from TILESET_FURNITURE metadata.
 */
export function registerTilesetSprites(sprites: Map<string, SpriteData>): void {
  // Phase 1: Register all entries into FURNITURE_CATALOG
  for (const tsEntry of TILESET_FURNITURE) {
    const sprite = sprites.get(tsEntry.id)
    if (!sprite) continue

    const existing = FURNITURE_CATALOG.findIndex((e) => e.type === tsEntry.id)
    const entry = tilesetEntryToCatalog(tsEntry, sprite)
    if (existing >= 0) {
      FURNITURE_CATALOG[existing] = entry
    } else {
      FURNITURE_CATALOG.push(entry)
    }
  }

  // Phase 2: Build rotation groups from groupId + orientation
  const groupMap = new Map<string, Map<string, string>>()
  for (const tsEntry of TILESET_FURNITURE) {
    if (tsEntry.groupId && tsEntry.orientation) {
      if (tsEntry.state && tsEntry.state !== 'off') continue
      let orientMap = groupMap.get(tsEntry.groupId)
      if (!orientMap) {
        orientMap = new Map()
        groupMap.set(tsEntry.groupId, orientMap)
      }
      orientMap.set(tsEntry.orientation, tsEntry.id)
    }
  }

  const orientationOrder = ['front', 'right', 'back', 'left']
  for (const orientMap of groupMap.values()) {
    if (orientMap.size < 2) continue
    const orderedOrients = orientationOrder.filter((o) => orientMap.has(o))
    if (orderedOrients.length < 2) continue
    const members: Record<string, string> = {}
    for (const o of orderedOrients) {
      members[o] = orientMap.get(o)!
    }
    const rg: RotationGroup = { orientations: orderedOrients, members }
    for (const id of Object.values(members)) {
      rotationGroups.set(id, rg)
    }
  }

  // Phase 3: Build state groups (on ↔ off pairs)
  const stateMap = new Map<string, Map<string, string>>()
  for (const tsEntry of TILESET_FURNITURE) {
    if (tsEntry.groupId && tsEntry.state) {
      const key = `${tsEntry.groupId}|${tsEntry.orientation || ''}`
      let sm = stateMap.get(key)
      if (!sm) {
        sm = new Map()
        stateMap.set(key, sm)
      }
      sm.set(tsEntry.state, tsEntry.id)
    }
  }
  for (const sm of stateMap.values()) {
    const onId = sm.get('on')
    const offId = sm.get('off')
    if (onId && offId) {
      stateGroups.set(onId, offId)
      stateGroups.set(offId, onId)
      offToOn.set(offId, onId)
      onToOff.set(onId, offId)
    }
  }

  // Phase 4: Register rotation groups for "on" state variants
  for (const tsEntry of TILESET_FURNITURE) {
    if (tsEntry.groupId && tsEntry.orientation && tsEntry.state === 'on') {
      const offCounterpart = stateGroups.get(tsEntry.id)
      if (offCounterpart) {
        const offGroup = rotationGroups.get(offCounterpart)
        if (offGroup) {
          const onMembers: Record<string, string> = {}
          for (const orient of offGroup.orientations) {
            const offId = offGroup.members[orient]
            const onId = stateGroups.get(offId)
            onMembers[orient] = onId ?? offId
          }
          const onGroup: RotationGroup = { orientations: offGroup.orientations, members: onMembers }
          for (const id of Object.values(onMembers)) {
            if (!rotationGroups.has(id)) {
              rotationGroups.set(id, onGroup)
            }
          }
        }
      }
    }
  }
}

function tilesetEntryToCatalog(ts: TilesetFurnitureEntry, sprite: SpriteData): CatalogEntryWithCategory {
  return {
    type: ts.id,
    label: ts.label,
    footprintW: ts.footprintW,
    footprintH: ts.footprintH,
    sprite,
    isDesk: ts.isDesk,
    category: ts.category,
    canPlaceOnSurfaces: ts.canPlaceOnSurfaces,
    backgroundTiles: ts.backgroundTiles,
    canPlaceOnWalls: ts.canPlaceOnWalls,
    ...(ts.orientation ? { orientation: ts.orientation } : {}),
  }
}

export function getCatalogEntry(type: string): CatalogEntryWithCategory | undefined {
  return FURNITURE_CATALOG.find((e) => e.type === type)
}

/** Returns the "on" variant if this type has one, otherwise returns the type unchanged. */
export function getOnStateType(currentType: string): string {
  return offToOn.get(currentType) ?? currentType
}

/** Returns the "off" variant if this type has one, otherwise returns the type unchanged. */
export function getOffStateType(currentType: string): string {
  return onToOff.get(currentType) ?? currentType
}

/** Returns the next asset ID in the rotation group (cw or ccw), or null if not rotatable. */
export function getRotatedType(currentType: string, direction: 'cw' | 'ccw' = 'cw'): string | null {
  const group = rotationGroups.get(currentType)
  if (!group) return null
  const order = group.orientations.map((o) => group.members[o])
  const idx = order.indexOf(currentType)
  if (idx === -1) return null
  const step = direction === 'cw' ? 1 : -1
  const nextIdx = (idx + step + order.length) % order.length
  return order[nextIdx]
}

/** Returns the toggled state variant (on↔off), or null if no state variant exists. */
export function getToggledType(currentType: string): string | null {
  return stateGroups.get(currentType) ?? null
}

/** Returns true if the given furniture type is part of a rotation group. */
export function isRotatable(type: string): boolean {
  return rotationGroups.has(type)
}

/** Get catalog entries filtered by category */
export function getCatalogByCategory(category: FurnitureCategory): CatalogEntryWithCategory[] {
  return FURNITURE_CATALOG.filter((e) => e.category === category)
}

/**
 * Register custom sprites (from room ZIP imports) into the catalog.
 * These use the 'misc' category and are not part of the built-in tileset.
 */
/** Map a tile tag to catalog properties */
function tagToCatalogProps(tag?: string): { isDesk: boolean; category: FurnitureCategory } {
  const t = (tag ?? '').toLowerCase().trim()
  if (t === 'desk' || t === 'table') return { isDesk: true, category: 'desks' }
  if (t === 'chair' || t === 'seat' || t.includes('sofa') || t.includes('couch')) return { isDesk: false, category: 'chairs' }
  if (t === 'storage' || t === 'shelf' || t === 'bookshelf') return { isDesk: false, category: 'storage' }
  if (t === 'plant' || t === 'decor' || t === 'lamp') return { isDesk: false, category: 'decor' }
  if (t === 'pc' || t === 'monitor' || t === 'computer') return { isDesk: false, category: 'electronics' }
  return { isDesk: false, category: 'misc' }
}

export function registerCustomSprites(
  sprites: Map<string, { sprite: SpriteData; footprintW: number; footprintH: number; label: string; tag?: string }>,
): void {
  for (const [type, data] of sprites) {
    const existing = FURNITURE_CATALOG.findIndex((e) => e.type === type)
    const props = tagToCatalogProps(data.tag)
    const entry: CatalogEntryWithCategory = {
      type,
      label: data.label,
      footprintW: data.footprintW,
      footprintH: data.footprintH,
      sprite: data.sprite,
      isDesk: false,
      category: 'decor',
      // Furniture sprites block their full footprint area.
      // Users should arrange layout to avoid blocking paths.
    }
    if (existing >= 0) {
      FURNITURE_CATALOG[existing] = entry
    } else {
      FURNITURE_CATALOG.push(entry)
    }
  }
}

/** Get list of active (non-empty) furniture categories in the catalog */
export function getActiveCategories(): Array<{ id: FurnitureCategory; label: string }> {
  const activeCats = new Set<FurnitureCategory>()
  for (const e of FURNITURE_CATALOG) {
    if (e.category) activeCats.add(e.category)
  }
  return FURNITURE_CATEGORIES.filter((c) => activeCats.has(c.id))
}
