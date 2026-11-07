// ---------------------------------------------------------------------------
// Hand-off choreography (plan P1.4). Cosmetic only: the daemon owns timing and
// starts the real work after HANDOFF.durationMs whether or not anything animates.
//
// Per character: a FIFO of hand-offs, so concurrent ones serialize. One hand-off is
//   WALK_TO  walk to a free tile next to the recipient (speed scaled so the walk plus
//            the hand-over ends at the daemon's deadline, clamped to a sane range;
//            when even the top speed is too slow, skip ahead along the path)
//   HANDOFF  face each other, paper prop, speech bubble with the label (~600 ms, or
//            longer when the walk arrived early, so it ends on the deadline)
//   RETURN   walk back to where it started (skipped when another hand-off is queued)
// Instant mode (no path, hidden tab, durationMs 0, reduced motion, deadline passed):
// nobody moves; the giver shows the bubble and the recipient flashes the paper.
// ---------------------------------------------------------------------------

import { CharacterState, Direction, TILE_SIZE, TileType } from '../types'
import type { Character, Seat, TileType as TileTypeVal } from '../types'
import { findPath, isWalkable } from '../layout/tileMap'
import { WALK_SPEED_PX_PER_SEC, WALK_FRAME_DURATION_SEC, SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC, WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC } from '../constants'

/** Hand-over time inside the daemon's duration (owner decision §0.4: ~0.6 s of 2.5 s) */
export const HANDOFF_HOLD_MS = 600
/** The hand-over never takes more than this share of a short duration */
const HANDOFF_HOLD_SHARE = 0.24
/** Walking speed range, in world px/s before the map's character scale */
export const MIN_WALK_PX_PER_SEC = 24
export const MAX_WALK_PX_PER_SEC = 192
const RETURN_SPEED_FACTOR = 1.25
/** How long a received paper stays visible on the recipient */
export const PAPER_FLASH_SEC = 1.5
/** Minimum time budget for a hand-off that starts late (it queued behind another one) */
export const LATE_WALK_BUDGET_MS = 1200
/** How far (in tiles) to look for a free spot next to the recipient */
const TARGET_SEARCH_RADIUS = 4

export interface HandoffRequest {
  fromCharId: number
  /** null when the recipient is not in the scene */
  toCharId: number | null
  /** Text for the giver's speech bubble */
  bubbleText: string
  /** performance.now() time at which the daemon starts the work */
  deadline: number
  /** Skip the walk (durationMs 0, hidden tab, reduced motion) */
  instant: boolean
  resolve: () => void
}

interface ActiveAction {
  req: HandoffRequest
  phase: 'walk_to' | 'handoff' | 'return'
  origin: { col: number; row: number }
  speed: number
  holdLeftSec: number
}

export interface ChoreoHost {
  tileMap: TileTypeVal[][]
  blockedTiles: Set<string>
  seats: Map<string, Seat>
  characterScale: number
  getChar(charId: number): Character | undefined
  say(ch: Character, text: string): void
  /** Run fn with the character's own seat tile unblocked (so paths can start/end there) */
  withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T
  now(): number
}

const tileCenter = (col: number, row: number) => ({ x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 })

function facing(fromCol: number, fromRow: number, toCol: number, toRow: number): Direction {
  const dc = toCol - fromCol
  const dr = toRow - fromRow
  if (Math.abs(dc) >= Math.abs(dr) && dc !== 0) return dc > 0 ? Direction.RIGHT : Direction.LEFT
  if (dr !== 0) return dr > 0 ? Direction.DOWN : Direction.UP
  return Direction.DOWN
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)

export class Choreographer {
  private queues = new Map<number, HandoffRequest[]>()
  private active = new Map<number, ActiveAction>()

  constructor(private host: ChoreoHost) {}

  /** Characters with a hand-off playing or queued */
  isBusy(charId: number): boolean {
    return this.active.has(charId) || (this.queues.get(charId)?.length ?? 0) > 0
  }

  hasWork(): boolean {
    return this.active.size > 0 || [...this.queues.values()].some((q) => q.length > 0)
  }

  enqueue(req: HandoffRequest): void {
    const q = this.queues.get(req.fromCharId) ?? []
    q.push(req)
    this.queues.set(req.fromCharId, q)
  }

  /** Advance one busy character. Call instead of the normal state machine. */
  update(ch: Character, dt: number): void {
    let act = this.active.get(ch.id)
    if (!act) {
      act = this.beginNext(ch) ?? undefined
      if (!act) return
    }
    ch.frameTimer += dt

    if (act.phase === 'walk_to' || act.phase === 'return') {
      if (this.step(ch, dt, act.speed)) return
      if (act.phase === 'walk_to') this.arrive(ch, act)
      else this.settle(ch, act)
      return
    }

    // Hand-over
    act.holdLeftSec -= dt
    if (act.holdLeftSec > 0) return
    this.completeHandover(ch, act)
    if ((this.queues.get(ch.id)?.length ?? 0) > 0) {
      // Go straight to the next recipient
      this.active.delete(ch.id)
      const next = this.beginNext(ch, act.origin)
      if (!next) this.settleAt(ch, act.origin)
      return
    }
    const path = this.host.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, act.origin.col, act.origin.row, this.host.tileMap, this.host.blockedTiles))
    if (path.length === 0) {
      this.settle(ch, act)
      return
    }
    act.phase = 'return'
    act.speed = WALK_SPEED_PX_PER_SEC * this.host.characterScale * RETURN_SPEED_FACTOR
    ch.path = path
    ch.moveProgress = 0
    ch.state = CharacterState.RETURN
    ch.frame = 0
    ch.frameTimer = 0
  }

  /** Finish everything now (hidden tab, reconnect, layout change): everyone back home. */
  finishAll(): void {
    for (const [charId, act] of [...this.active]) {
      const ch = this.host.getChar(charId)
      if (act.phase !== 'return') act.req.resolve()
      if (ch) {
        ch.carrying = false
        this.settleAt(ch, act.origin)
      }
    }
    this.active.clear()
    for (const q of this.queues.values()) for (const req of q) req.resolve()
    this.queues.clear()
  }

  /** A character left the scene: drop its hand-offs. */
  forget(charId: number): void {
    const act = this.active.get(charId)
    if (act && act.phase !== 'return') act.req.resolve()
    this.active.delete(charId)
    for (const req of this.queues.get(charId) ?? []) req.resolve()
    this.queues.delete(charId)
  }

  // ── internals ─────────────────────────────────────────────────

  private beginNext(ch: Character, originOverride?: { col: number; row: number }): ActiveAction | null {
    const q = this.queues.get(ch.id)
    while (q && q.length > 0) {
      const req = q.shift()!
      const act = this.begin(ch, req, originOverride)
      if (act) return act
      // Instant hand-off already done; try the next one
    }
    this.queues.delete(ch.id)
    return null
  }

  /** Start one hand-off. Returns null when it played instantly. */
  private begin(ch: Character, req: HandoffRequest, originOverride?: { col: number; row: number }): ActiveAction | null {
    const to = req.toCharId !== null ? this.host.getChar(req.toCharId) : undefined
    // A hand-off that waited behind another one may be past its deadline already (the
    // daemon started the work on time). It still gets a short, fast walk: cosmetic only.
    const remainingMs = Math.max(req.deadline - this.host.now(), LATE_WALK_BUDGET_MS)
    if (req.instant || !to || to === ch || ch.matrixEffect) {
      this.playInstant(ch, to, req)
      return null
    }

    this.snapToTile(ch)
    if (ch.restSeatId) {
      const rs = this.host.seats.get(ch.restSeatId)
      if (rs) rs.assigned = false
      ch.restSeatId = null
    }
    this.holdStill(to, remainingMs / 1000 + 1.5)

    const target = this.findTarget(ch, to)
    if (!target) {
      this.playInstant(ch, to, req)
      return null
    }

    // Where to walk back to (captured before any skip-ahead below moves the giver)
    const origin = originOverride ?? { col: ch.tileCol, row: ch.tileRow }
    const holdMs = Math.min(HANDOFF_HOLD_MS, remainingMs * HANDOFF_HOLD_SHARE)
    const walkSec = Math.max(0.05, (remainingMs - holdMs) / 1000)
    const scale = this.host.characterScale
    const minSpeed = MIN_WALK_PX_PER_SEC * scale
    const maxSpeed = MAX_WALK_PX_PER_SEC * scale
    let path = target.path
    let speed = (path.length * TILE_SIZE) / walkSec
    if (speed > maxSpeed) {
      // Too far to make it in time even at top speed: skip ahead along the path
      const reachable = Math.floor((maxSpeed * walkSec) / TILE_SIZE)
      const skip = path.length - Math.max(1, reachable)
      if (skip > 0) {
        const jump = path[skip - 1]
        this.placeAt(ch, jump.col, jump.row)
        path = path.slice(skip)
      }
      speed = maxSpeed
    }
    speed = Math.max(minSpeed, Math.min(maxSpeed, speed))

    const act: ActiveAction = {
      req,
      phase: 'walk_to',
      origin,
      speed,
      holdLeftSec: 0,
    }
    this.active.set(ch.id, act)
    ch.carrying = true
    ch.path = path
    ch.moveProgress = 0
    ch.state = CharacterState.WALK_TO
    ch.frame = 0
    ch.frameTimer = 0
    if (path.length === 0) this.arrive(ch, act)
    return act
  }

  private playInstant(ch: Character, to: Character | undefined, req: HandoffRequest): void {
    this.host.say(ch, req.bubbleText)
    if (to) to.paperTimer = PAPER_FLASH_SEC
    req.resolve()
  }

  private arrive(ch: Character, act: ActiveAction): void {
    act.phase = 'handoff'
    ch.state = CharacterState.HANDOFF
    ch.frame = 0
    const to = act.req.toCharId !== null ? this.host.getChar(act.req.toCharId) : undefined
    if (to) {
      ch.dir = facing(ch.tileCol, ch.tileRow, to.tileCol, to.tileRow)
      // The recipient turns around unless it is busy walking or typing at its desk
      if (to.state === CharacterState.IDLE && !this.isBusy(to.id)) {
        to.dir = facing(to.tileCol, to.tileRow, ch.tileCol, ch.tileRow)
      }
    }
    this.host.say(ch, act.req.bubbleText)
    // Hold until the daemon's deadline, but at least a short beat so it reads as a hand-over
    const leftMs = act.req.deadline - this.host.now()
    act.holdLeftSec = Math.max(0.35, leftMs / 1000)
  }

  private completeHandover(ch: Character, act: ActiveAction): void {
    ch.carrying = false
    const to = act.req.toCharId !== null ? this.host.getChar(act.req.toCharId) : undefined
    if (to) to.paperTimer = PAPER_FLASH_SEC
    act.req.resolve()
  }

  private settle(ch: Character, act: ActiveAction): void {
    this.active.delete(ch.id)
    this.settleAt(ch, act.origin)
    // A hand-off may have been queued during the walk back
    if ((this.queues.get(ch.id)?.length ?? 0) === 0) this.queues.delete(ch.id)
  }

  /** Put the character back into the normal state machine at a tile (its seat if it is there). */
  private settleAt(ch: Character, at: { col: number; row: number }): void {
    if (ch.tileCol !== at.col || ch.tileRow !== at.row) this.placeAt(ch, at.col, at.row)
    ch.path = []
    ch.moveProgress = 0
    ch.frame = 0
    ch.frameTimer = 0
    const seat = ch.seatId ? this.host.seats.get(ch.seatId) : undefined
    if (seat && seat.seatCol === at.col && seat.seatRow === at.row) {
      ch.state = CharacterState.TYPE
      ch.dir = seat.facingDir
      ch.seatTimer = ch.isBoss ? Infinity : ch.isActive ? 0 : rand(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC)
    } else {
      ch.state = CharacterState.IDLE
      ch.wanderTimer = ch.isBoss ? Infinity : rand(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC)
    }
  }

  /** Walk along ch.path. Returns true while still walking. */
  private step(ch: Character, dt: number, speed: number): boolean {
    if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
      ch.frameTimer -= WALK_FRAME_DURATION_SEC
      ch.frame = (ch.frame + 1) % 4
    }
    if (ch.path.length === 0) return false
    ch.moveProgress += (speed / TILE_SIZE) * dt
    while (ch.moveProgress >= 1 && ch.path.length > 0) {
      const next = ch.path.shift()!
      ch.tileCol = next.col
      ch.tileRow = next.row
      ch.moveProgress -= 1
    }
    if (ch.path.length === 0) {
      const c = tileCenter(ch.tileCol, ch.tileRow)
      ch.x = c.x
      ch.y = c.y
      ch.moveProgress = 0
      return false
    }
    const next = ch.path[0]
    ch.dir = facing(ch.tileCol, ch.tileRow, next.col, next.row)
    const from = tileCenter(ch.tileCol, ch.tileRow)
    const to = tileCenter(next.col, next.row)
    ch.x = from.x + (to.x - from.x) * ch.moveProgress
    ch.y = from.y + (to.y - from.y) * ch.moveProgress
    return true
  }

  private placeAt(ch: Character, col: number, row: number): void {
    ch.tileCol = col
    ch.tileRow = row
    const c = tileCenter(col, row)
    ch.x = c.x
    ch.y = c.y
  }

  /**
   * A wandering recipient stops and waits for the paper (an idle one stays put for the
   * whole walk). Recipients walking to their desk to work, typing, or busy with their
   * own hand-off are left alone.
   */
  private holdStill(to: Character, seconds: number): void {
    if (to.isActive || this.isBusy(to.id)) return
    if (to.state === CharacterState.WALK) {
      this.snapToTile(to)
      to.state = CharacterState.IDLE
      to.frame = 0
      if (to.restSeatId) {
        const rs = this.host.seats.get(to.restSeatId)
        if (rs) rs.assigned = false
        to.restSeatId = null
      }
    }
    if (to.state === CharacterState.IDLE && !to.restSeatId) to.wanderTimer = Math.max(to.wanderTimer, seconds)
  }

  /** Mid-walk characters snap to the nearer tile before a hand-off starts. */
  private snapToTile(ch: Character): void {
    if (ch.path.length > 0 && ch.moveProgress >= 0.5) {
      const next = ch.path[0]
      this.placeAt(ch, next.col, next.row)
    } else {
      this.placeAt(ch, ch.tileCol, ch.tileRow)
    }
    ch.path = []
    ch.moveProgress = 0
  }

  /**
   * A walkable tile next to the recipient (next to its seat when it sits there),
   * nearest first, that the giver can reach. BFS over neighbours, reusing findPath
   * with the giver's own seat temporarily unblocked.
   */
  private findTarget(ch: Character, to: Character): { col: number; row: number; path: Array<{ col: number; row: number }> } | null {
    const seat = to.seatId ? this.host.seats.get(to.seatId) : undefined
    const atSeat = seat && to.tileCol === seat.seatCol && to.tileRow === seat.seatRow
    const anchor = atSeat
      ? { col: seat.seatCol, row: seat.seatRow }
      : to.path.length > 0
        ? to.path[to.path.length - 1]
        : { col: to.tileCol, row: to.tileRow }
    const { tileMap, blockedTiles } = this.host

    const seen = new Set<string>([`${anchor.col},${anchor.row}`])
    let ring = [anchor]
    const candidates: Array<{ col: number; row: number }> = []
    for (let d = 1; d <= TARGET_SEARCH_RADIUS && candidates.length < 12; d++) {
      const nextRing: Array<{ col: number; row: number }> = []
      for (const t of ring) {
        // Side by side first, so the giver does not hide the recipient
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, 1], [0, -1]] as const) {
          const n = { col: t.col + dc, row: t.row + dr }
          const key = `${n.col},${n.row}`
          if (seen.has(key)) continue
          seen.add(key)
          // Never look through a wall: the spot must be in the recipient's room
          const tile = tileMap[n.row]?.[n.col]
          if (tile === undefined || tile === TileType.WALL || tile === TileType.VOID) continue
          nextRing.push(n)
          if (isWalkable(n.col, n.row, tileMap, blockedTiles)) candidates.push(n)
        }
      }
      ring = nextRing
    }

    for (const c of candidates) {
      if (c.col === ch.tileCol && c.row === ch.tileRow) return { ...c, path: [] }
      const path = this.host.withOwnSeatUnblocked(ch, () => findPath(ch.tileCol, ch.tileRow, c.col, c.row, tileMap, blockedTiles))
      if (path.length > 0) return { ...c, path }
    }
    return null
  }
}
