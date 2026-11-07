// Phase 3: zones in the layout model, seat rules, the default floor plan and themes.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createDefaultLayout, deserializeLayout, layoutToSeats, layoutToTileMap, getBlockedTiles } from '../layoutSerializer'
import { hasZones, paintZone, pickSeat, zoneAt } from '../zones'
import { findPath } from '../tileMap'
import { OFFICE_DOORS } from '../defaultOffice'
import { applyPaletteTheme, parsePaletteTheme } from '../themes'
import { TileType, type OfficeLayout, type Seat } from '../../types'

const layout = createDefaultLayout()
const seatsOf = (l: OfficeLayout) => layoutToSeats(l.furniture, (c, r) => zoneAt(l, c, r))

describe('default floor plan', () => {
  it('is a v2 layout with a zone map for every room', () => {
    assert.equal(layout.version, 2)
    assert.equal(layout.zones?.length, layout.tiles.length)
    for (const z of ['boss_room', 'lead_area', 'dev_area', 'pantry'] as const) {
      assert.ok(layout.zones!.includes(z), z)
    }
  })

  it('has one Boss seat, a Lead and a reviewer desk, and eight dev desks', () => {
    const seats = [...seatsOf(layout).values()].filter((s) => !s.isRest)
    const boss = seats.filter((s) => s.isBoss)
    assert.equal(boss.length, 1)
    assert.equal(boss[0].uid, 'boss-chair')
    assert.equal(boss[0].zone, 'boss_room')
    assert.deepEqual(seats.filter((s) => s.zone === 'lead_area').map((s) => s.uid).sort(), ['lead-chair', 'review-chair'])
    assert.equal(seats.filter((s) => s.zone === 'dev_area').length, 8)
  })

  it('gives every desk the chair next to any of its tiles (3-wide Boss desk too)', () => {
    const seats = seatsOf(layout)
    assert.equal(seats.get('boss-chair')?.facingDir, 0 /* DOWN */)
    assert.equal(seats.get('lead-chair')?.facingDir, 3 /* UP */)
    assert.ok(!seats.has('boss-desk'), 'no standing seat at the Boss desk')
  })

  it('connects the rooms through the doorways only', () => {
    const tileMap = layoutToTileMap(layout)
    const blocked = getBlockedTiles(layout.furniture)
    const seats = seatsOf(layout)
    const boss = seats.get('boss-chair')!
    const lead = seats.get('lead-chair')!
    blocked.delete(`${boss.seatCol},${boss.seatRow}`)
    blocked.delete(`${lead.seatCol},${lead.seatRow}`)
    const path = findPath(boss.seatCol, boss.seatRow, lead.seatCol, lead.seatRow, tileMap, blocked)
    assert.ok(path.length > 0, 'the Boss can walk to the Lead')
    const bossDoor = OFFICE_DOORS[0]
    assert.ok(path.some((t) => t.col === bossDoor.col && t.row === bossDoor.row), 'through the Boss door')
    assert.ok(!path.some((t) => t.col === bossDoor.col && t.row === bossDoor.row + 1), 'never through the jamb tile')
    for (const t of path) assert.notEqual(tileMap[t.row][t.col], TileType.WALL)
    const pantryDoor = OFFICE_DOORS[1]
    const dev = seats.get('dev-chair-1')!
    blocked.delete(`${dev.seatCol},${dev.seatRow}`)
    const fromPantry = findPath(4, 14, dev.seatCol, dev.seatRow, tileMap, blocked)
    assert.ok(fromPantry.some((t) => t.col === pantryDoor.col && t.row === pantryDoor.row), 'pantry → dev room through its door')
  })
})

describe('seat rules', () => {
  const take = (seats: Map<string, Seat>, role: Parameters<typeof pickSeat>[1]) => {
    const id = pickSeat(seats, role, true)
    if (id) seats.get(id)!.assigned = true
    return id
  }

  it('Lead → Lead desk, reviewer → the other Lead-area desk, devs → dev desks in reading order', () => {
    const seats = seatsOf(layout)
    const devFirst = take(seats, 'dev')
    assert.equal(take(seats, 'reviewer'), 'review-chair')
    assert.equal(take(seats, 'lead'), 'lead-chair', 'the Lead desk stays free for the Lead')
    const devs = [devFirst]
    for (let i = 0; i < 7; i++) devs.push(take(seats, 'dev'))
    assert.deepEqual(devs, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `dev-chair-${n}`))
    assert.equal(take(seats, 'dev'), null, 'nine devs: the ninth has no desk')
  })

  it('never hands out the Boss seat or rest seats', () => {
    const seats = seatsOf(layout)
    const all: Array<string | null> = []
    for (let i = 0; i < 20; i++) all.push(take(seats, i % 2 ? 'dev' : undefined))
    assert.ok(!all.includes('boss-chair'))
    assert.ok(all.every((id) => id === null || !seats.get(id)!.isRest))
  })

  it('layouts without zones keep the old "first free seat" rule', () => {
    const v1: OfficeLayout = { ...layout, version: 1, zones: undefined }
    assert.equal(hasZones(v1), false)
    const seats = layoutToSeats(v1.furniture)
    const first = [...seats.values()].find((s) => !s.isRest && !s.isBoss)!.uid
    assert.equal(pickSeat(seats, 'lead', false), first)
  })
})

describe('layout format', () => {
  it('loads v1 files unchanged and drops a malformed zone map', () => {
    const v1 = deserializeLayout(JSON.stringify({ ...layout, version: 1, zones: undefined }))
    assert.equal(v1?.version, 1)
    assert.equal(v1?.zones, undefined)
    const bad = deserializeLayout(JSON.stringify({ ...layout, zones: ['boss_room'] }))
    assert.equal(bad?.zones, undefined)
    const odd = deserializeLayout(JSON.stringify({ ...layout, zones: layout.zones!.map((z, i) => (i === 0 ? 'attic' : z)) }))
    assert.equal(odd?.zones?.[0], null)
    assert.equal(deserializeLayout(JSON.stringify({ ...layout, version: 3 })), null)
  })

  it('paintZone sets one tile and upgrades to v2', () => {
    const v1: OfficeLayout = { ...layout, version: 1, zones: undefined }
    const painted = paintZone(v1, 2, 2, 'meeting')
    assert.equal(painted.version, 2)
    assert.equal(zoneAt(painted, 2, 2), 'meeting')
    assert.equal(painted.zones!.filter(Boolean).length, 1)
    assert.equal(paintZone(painted, 2, 2, 'meeting'), painted, 'no-op returns the same layout')
  })
})

describe('palette themes', () => {
  it('validates untrusted theme data and recolors floors by zone', () => {
    assert.equal(parsePaletteTheme({ kind: 'palette' }), null)
    assert.equal(parsePaletteTheme({ version: 1, kind: 'zip' }), null)
    const theme = parsePaletteTheme({
      version: 1, kind: 'palette',
      walls: { h: 250, s: 20, b: -50 },
      floors: { dev_area: { h: 10, s: 20, b: 30, c: 0, colorize: true }, attic: { h: 1, s: 1, b: 1 }, pantry: { h: 'x' } },
    })!
    assert.deepEqual(Object.keys(theme.floors!), ['dev_area'])
    const themed = applyPaletteTheme(layout, theme)
    const i = layout.zones!.indexOf('dev_area')
    assert.deepEqual(themed.tileColors![i], { h: 10, s: 20, b: 30, c: 0, colorize: true })
    const w = layout.tiles.indexOf(TileType.WALL)
    assert.deepEqual(themed.tileColors![w], { h: 250, s: 20, b: -50, c: 0 })
    const p = layout.zones!.indexOf('pantry')
    assert.deepEqual(themed.tileColors![p], layout.tileColors![p], 'zones the theme does not name keep their color')
  })
})
