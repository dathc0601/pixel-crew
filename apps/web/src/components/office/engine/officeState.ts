import { TILE_SIZE, MATRIX_EFFECT_DURATION, CharacterState, Direction } from '../types'
import type { Character, Seat, SeatRole, FurnitureInstance, TileType as TileTypeVal, OfficeLayout, PlacedFurniture } from '../types'
import { createCharacter, updateCharacter } from './characters'
import { Choreographer, type HandoffRequest } from './choreography'
import { matrixEffectSeeds } from './matrixEffect'
import { isWalkable, getWalkableTiles, findPath } from '../layout/tileMap'
import {
  createDefaultLayout,
  layoutToTileMap,
  layoutToFurnitureInstances,
  layoutToSeats,
  getBlockedTiles,
} from '../layout/layoutSerializer'
import { getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog'
import { hasZones, pickSeat, zoneAt } from '../layout/zones'
import {
  PALETTE_COUNT,
  HUE_SHIFT_MIN_DEG,
  HUE_SHIFT_RANGE_DEG,
  WAITING_BUBBLE_DURATION_SEC,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  SPEECH_BUBBLE_DURATION_SEC,
  SPEECH_BUBBLE_MAX_CHARS,
  TYPE_FRAME_DURATION_SEC,
  DEFAULT_COLS,
  DEFAULT_ROWS,
} from '../constants'
import type { AgentStatus } from '@pixel-crew/shared'

/**
 * Bridge between our Zustand store (string agentIds) and the pixel-agents
 * engine (numeric Character.id). Manages the office layout, characters,
 * seat assignments, and matrix effects.
 */
/** Clickable scene objects that are not agents */
export type SceneObjectId = 'boss' | 'task-board'

/** Resting time for characters snapped to their seats after a reconnect */
const SEAT_REST_ON_SNAP_SEC = 60

export class OfficeState {
  layout: OfficeLayout
  backgroundImage: HTMLImageElement | null = null
  tileMap: TileTypeVal[][]
  seats: Map<string, Seat>
  blockedTiles: Set<string>
  furniture: FurnitureInstance[]
  walkableTiles: Array<{ col: number; row: number }>
  /** Where idle agents spawn and wander: walkable tiles outside the Boss's room */
  wanderTiles: Array<{ col: number; row: number }>
  /** The layout has a zone map (seat rules follow zones) */
  zoned = false
  /** The wall-mounted task board next to the Lead, in world px (null when the layout has none) */
  taskBoardFurnitureRect: { x: number; y: number; w: number; h: number } | null = null
  /** Scene clock in seconds; typing frames of all working agents follow it, so they redraw together */
  private clock = 0
  characters: Map<number, Character> = new Map()
  selectedCharId: number | null = null
  hoveredCharId: number | null = null
  /** Scale factor for characters relative to default map size */
  characterScale = 1
  /** Dirty flag — set to true when scene changes and needs re-render */
  dirty = true
  /**
   * Seconds until a timer needs the next update (0 = every frame, null = nothing pending).
   * The game loop sleeps in between instead of polling with rAF.
   */
  nextWakeSec: number | null = null
  /** Optional callback to wake the game loop from sleep */
  onDirty: (() => void) | null = null

  // ── Cached character list (avoid Array.from each frame) ─────
  private _cachedChars: Character[] = []
  private _charListDirty = true

  /** Mark scene as dirty and wake the render loop if sleeping */
  private markDirty(): void {
    this.dirty = true
    this.onDirty?.()
  }

  // ── Boss flow (P1.4–P1.6) ──────────────────────────────────────
  /** Hand-off walks; busy characters skip the normal state machine */
  readonly choreo: Choreographer
  /** Queue board next to the Lead (P1.6), or null when nothing waits */
  taskBoard: { charId: number; count: number } | null = null
  /** Mini "subagent" sprite next to a Lead: charId → seconds left */
  subagentCues = new Map<number, number>()
  /** Clicks on the Boss or the task board (set by the scene adapter) */
  onObjectClick: ((id: SceneObjectId) => void) | null = null
  /** Last task-board hit box in world px (set by the renderer) */
  taskBoardRect: { x: number; y: number; w: number; h: number } | null = null

  // ── Agent ID mapping ──────────────────────────────────────────
  private agentIdToCharId = new Map<string, number>()
  private charIdToAgentId = new Map<number, string>()
  private nextCharId = 1

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout()
    this.tileMap = layoutToTileMap(this.layout)
    this.seats = this.buildSeats(this.layout)
    this.blockedTiles = getBlockedTiles(this.layout.furniture)
    this.furniture = layoutToFurnitureInstances(this.layout.furniture)
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles)
    this.wanderTiles = this.computeWanderTiles()
    this.taskBoardFurnitureRect = this.findTaskBoard()
    this.characterScale = this.computeCharacterScale()
    // Getters, so the choreographer always sees the current layout after setLayout()
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const office = this
    this.choreo = new Choreographer({
      get tileMap() { return office.tileMap },
      get blockedTiles() { return office.blockedTiles },
      get seats() { return office.seats },
      get characterScale() { return office.characterScale },
      getChar: (id) => this.characters.get(id),
      say: (ch, text) => this.say(ch, text),
      withOwnSeatUnblocked: (ch, fn) => this.withOwnSeatUnblocked(ch, fn),
      now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    })
  }

  private buildSeats(layout: OfficeLayout): Map<string, Seat> {
    this.zoned = hasZones(layout)
    return layoutToSeats(layout.furniture, this.zoned ? (c, r) => zoneAt(layout, c, r) : undefined)
  }

  private computeWanderTiles(): Array<{ col: number; row: number }> {
    if (!this.zoned) return this.walkableTiles
    const open = this.walkableTiles.filter((t) => zoneAt(this.layout, t.col, t.row) !== 'boss_room')
    return open.length > 0 ? open : this.walkableTiles
  }

  private findTaskBoard(): { x: number; y: number; w: number; h: number } | null {
    const item = this.layout.furniture.find((f) => f.type === 'task-board')
    const entry = item ? getCatalogEntry(item.type) : undefined
    if (!item || !entry) return null
    return { x: item.col * TILE_SIZE, y: item.row * TILE_SIZE, w: entry.footprintW * TILE_SIZE, h: entry.footprintH * TILE_SIZE }
  }

  private computeCharacterScale(): number {
    const defaultSize = Math.max(DEFAULT_COLS, DEFAULT_ROWS)
    const currentSize = Math.max(this.layout.cols, this.layout.rows)
    if (currentSize <= defaultSize) return 1
    return Math.pow(currentSize / defaultSize, 0.75)
  }

  /** Set background image (from room ZIP import) */
  setBackgroundImage(img: HTMLImageElement | null): void {
    this.backgroundImage = img
    this.markDirty()
  }

  /** Hot-replace layout: rebuild tileMap, seats, furniture, reassign characters */
  setLayout(layout: OfficeLayout): void {
    this.choreo.finishAll()
    this.layout = layout
    this.tileMap = layoutToTileMap(layout)
    this.characterScale = this.computeCharacterScale()
    this.seats = this.buildSeats(layout)
    this.blockedTiles = getBlockedTiles(layout.furniture)
    this.furniture = layoutToFurnitureInstances(layout.furniture)
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles)
    this.wanderTiles = this.computeWanderTiles()
    this.taskBoardFurnitureRect = this.findTaskBoard()

    // Reassign characters to seats and relocate to valid positions
    for (const ch of this.characters.values()) {
      if (ch.isBoss) {
        ch.seatId = null
        this.placeBoss(ch)
        continue
      }
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId)
        if (seat) {
          seat.assigned = true
        } else {
          // Old seat no longer exists — try to find a new one
          ch.seatId = null
          const newSeatId = this.findFreeSeat(ch.seatRole)
          if (newSeatId) {
            const newSeat = this.seats.get(newSeatId)!
            newSeat.assigned = true
            ch.seatId = newSeatId
          }
        }
      }

      // Relocate character to a valid position in the new layout
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId)!
        ch.tileCol = seat.seatCol
        ch.tileRow = seat.seatRow
        ch.dir = seat.facingDir
      } else if (this.wanderTiles.length > 0) {
        const spawn = this.wanderTiles[Math.floor(Math.random() * this.wanderTiles.length)]
        ch.tileCol = spawn.col
        ch.tileRow = spawn.row
      }
      ch.x = ch.tileCol * TILE_SIZE + TILE_SIZE / 2
      ch.y = ch.tileRow * TILE_SIZE + TILE_SIZE / 2
      ch.path = []
      ch.moveProgress = 0
    }
    this.rebuildFurnitureInstances()
    this.markDirty()
  }

  // ── Public API (string agentId) ───────────────────────────────

  addCharacter(agentId: string, _name: string, palette?: number, isExternal?: boolean, label?: string, labelColor?: string, seatRole?: SeatRole): void {
    if (this.agentIdToCharId.has(agentId)) return

    const charId = this.nextCharId++
    this.agentIdToCharId.set(agentId, charId)
    this.charIdToAgentId.set(charId, agentId)

    const { palette: pickedPalette, hueShift } = palette !== undefined
      ? { palette, hueShift: 0 }
      : this.pickDiversePalette()

    // All agents start idle and wandering — work seats are assigned only when they become active
    const spawn = this.wanderTiles.length > 0
      ? this.wanderTiles[Math.floor(Math.random() * this.wanderTiles.length)]
      : { col: 1, row: 1 }
    const ch = createCharacter(charId, pickedPalette, null, null, hueShift, CharacterState.IDLE)
    if (seatRole) ch.seatRole = seatRole
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2
    ch.tileCol = spawn.col
    ch.tileRow = spawn.row

    // Mark as external if applicable
    if (isExternal) {
      ch.isExternal = true
    }
    if (label) ch.label = label
    if (labelColor) ch.labelColor = labelColor

    // Matrix spawn effect
    ch.matrixEffect = 'spawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()

    this.characters.set(charId, ch)
    this._charListDirty = true
    this.markDirty()
  }

  removeCharacter(agentId: string): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return

    const ch = this.characters.get(charId)
    if (!ch) return
    this.choreo.forget(charId)
    this.subagentCues.delete(charId)
    if (this.taskBoard?.charId === charId) this.taskBoard = null
    if (ch.matrixEffect === 'despawn') return // already despawning

    // Free seat
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId)
      if (seat) seat.assigned = false
    }

    if (this.selectedCharId === charId) this.selectedCharId = null

    // Start despawn animation
    ch.matrixEffect = 'despawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()
    ch.bubbleType = null
    this.markDirty()
  }

  updateCharacterStatus(agentId: string, status: AgentStatus, keepSeat?: boolean): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    const ch = this.characters.get(charId)
    if (!ch) return
    this.markDirty()

    const wasActive = ch.isActive
    const isNowActive = status === 'working' || status === 'waiting_approval'

    ch.isActive = isNowActive

    // Team members always need a seat — assign one if they don't have one yet,
    // regardless of current status. This avoids a race condition where the bridge
    // misses a brief "working" transition (leader finishes delegation in seconds).
    if (keepSeat && !ch.seatId) {
      if (ch.restSeatId) {
        const rs = this.seats.get(ch.restSeatId)
        if (rs) rs.assigned = false
        ch.restSeatId = null
        ch.seatTimer = 0
      }
      const seatId = this.findFreeSeat(ch.seatRole)
      if (seatId) {
        const seat = this.seats.get(seatId)!
        seat.assigned = true
        ch.seatId = seatId
        // A team member that just joined starts at its own desk (not wandering), so
        // hand-offs read as "walk over to that desk" from the first task on
        if (ch.matrixEffect === 'spawn' && !this.choreo.isBusy(ch.id)) this.seatAt(ch, seat, isNowActive)
      }
      this.rebuildFurnitureInstances()
    }

    if (!isNowActive && wasActive) {
      if (keepSeat) {
        // Team member: keep their seat between tasks
      } else {
        // Solo agent: release work seat so others can use it
        if (ch.seatId) {
          const seat = this.seats.get(ch.seatId)
          if (seat) seat.assigned = false
          ch.seatId = null
        }
        ch.seatTimer = -1
        ch.path = []
        ch.moveProgress = 0
      }
      this.rebuildFurnitureInstances()
    } else if (isNowActive && !wasActive) {
      // Just became active — find a free work seat
      if (!ch.seatId) {
        // Release rest seat if sitting on one
        if (ch.restSeatId) {
          const rs = this.seats.get(ch.restSeatId)
          if (rs) rs.assigned = false
          ch.restSeatId = null
          ch.seatTimer = 0
        }
        const seatId = this.findFreeSeat(ch.seatRole)
        if (seatId) {
          const seat = this.seats.get(seatId)!
          seat.assigned = true
          ch.seatId = seatId
        }
      }
      this.rebuildFurnitureInstances()
    }
  }

  /**
   * Label, colour and kind changed (an external session joined or left the team). Joining
   * sends it to its new desk right away; leaving frees the desk and it wanders off.
   */
  updateCharacterInfo(agentId: string, info: { label: string; labelColor: string; isExternal: boolean; attached: boolean }): void {
    const charId = this.agentIdToCharId.get(agentId)
    const ch = charId !== undefined ? this.characters.get(charId) : undefined
    if (!ch || ch.isBoss) return
    const joined = info.attached && !ch.attached
    const left = !info.attached && !!ch.attached
    ch.label = info.label
    ch.labelColor = info.labelColor
    ch.isExternal = info.isExternal
    ch.attached = info.attached
    if (joined && !this.choreo.isBusy(ch.id) && ch.state !== CharacterState.TYPE) {
      // Walk to the dev desk now instead of after the usual wander
      ch.wanderCount = ch.wanderLimit
      ch.wanderTimer = 0.3
    }
    if (left && ch.seatId) {
      const seat = this.seats.get(ch.seatId)
      if (seat) seat.assigned = false
      ch.seatId = null
      ch.seatRole = undefined
      if (ch.state === CharacterState.TYPE) {
        ch.state = CharacterState.IDLE
        ch.frame = 0
        ch.wanderTimer = 0.3
      }
      this.rebuildFurnitureInstances()
    }
    this.markDirty()
  }

  /**
   * Set the desk preference of an agent (its team role can arrive after it joined).
   * When the role changes the agent gives up its desk and walks to one that fits.
   */
  setSeatRole(agentId: string, role: SeatRole | undefined): void {
    const charId = this.agentIdToCharId.get(agentId)
    const ch = charId !== undefined ? this.characters.get(charId) : undefined
    if (!ch || ch.isBoss || ch.seatRole === role) return
    ch.seatRole = role
    if (!ch.seatId || !this.zoned) return
    const old = this.seats.get(ch.seatId)
    if (old) old.assigned = false
    const next = this.findFreeSeat(role)
    if (!next || next === ch.seatId) {
      if (old) old.assigned = true
      return
    }
    this.seats.get(next)!.assigned = true
    ch.seatId = next
    if (!this.choreo.isBusy(ch.id) && ch.state === CharacterState.TYPE) {
      // Stand up and walk over (active agents go straight away, idle ones after a short pause)
      ch.state = CharacterState.IDLE
      ch.frame = 0
      ch.wanderTimer = 0.3
      ch.wanderCount = ch.wanderLimit
    }
    this.rebuildFurnitureInstances()
    this.markDirty()
  }

  selectCharacter(agentId: string | null): void {
    const prev = this.selectedCharId
    if (agentId === null) {
      this.selectedCharId = null
    } else {
      const charId = this.agentIdToCharId.get(agentId)
      this.selectedCharId = charId ?? null
    }
    if (this.selectedCharId !== prev) this.markDirty()
  }

  showBubble(agentId: string, type: 'permission' | 'working' | 'waiting'): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    const ch = this.characters.get(charId)
    if (!ch) return

    if (type === 'permission' || type === 'working') {
      ch.bubbleType = type
      ch.bubbleTimer = 0  // persistent, no countdown
    } else {
      ch.bubbleType = 'waiting'
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC
    }
    this.markDirty()
  }

  clearBubble(agentId: string): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    const ch = this.characters.get(charId)
    if (!ch) return
    if (ch.bubbleType === 'permission' || ch.bubbleType === 'working') {
      ch.bubbleType = null
      ch.bubbleTimer = 0
    } else if (ch.bubbleType === 'waiting') {
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC)
    }
    this.markDirty()
  }

  showSpeechBubble(agentId: string, text: string): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    const ch = this.characters.get(charId)
    if (!ch) return
    this.say(ch, text)
  }

  private say(ch: Character, text: string): void {
    const truncated = text.length > SPEECH_BUBBLE_MAX_CHARS
      ? text.slice(0, SPEECH_BUBBLE_MAX_CHARS) + '...'
      : text
    ch.speechText = truncated
    ch.speechTimer = SPEECH_BUBBLE_DURATION_SEC
    this.markDirty()
  }

  // ── Getters for renderer ──────────────────────────────────────

  getCharacters(): Character[] {
    if (this._charListDirty) {
      this._cachedChars = Array.from(this.characters.values())
      this._charListDirty = false
    }
    return this._cachedChars
  }

  getLayout(): OfficeLayout {
    return this.layout
  }

  getSelectedCharId(): number | null {
    return this.selectedCharId
  }

  getHoveredCharId(): number | null {
    return this.hoveredCharId
  }

  /** Get the string agentId for a character (numeric) id */
  getAgentId(charId: number): string | null {
    return this.charIdToAgentId.get(charId) ?? null
  }

  /** Get character at pixel position (for hit testing). Returns agentId or null. */
  getAgentAtPixel(worldX: number, worldY: number): string | null {
    const s = this.characterScale
    // Iterate characters sorted by descending Y (frontmost first) without allocating a new array
    const chars = this.getCharacters()
    let hitId: string | null = null
    let hitY = -Infinity
    for (const ch of chars) {
      if (ch.matrixEffect === 'despawn') continue
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
      const anchorY = ch.y + sittingOffset
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH * s
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH * s
      const top = anchorY - CHARACTER_HIT_HEIGHT * s
      const bottom = anchorY
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        // Pick the frontmost (highest Y) hit
        if (ch.y > hitY) {
          hitY = ch.y
          hitId = this.charIdToAgentId.get(ch.id) ?? null
        }
      }
    }
    return hitId
  }

  /** Set hovered character by numeric id (for outline rendering) */
  setHoveredCharAtPixel(worldX: number, worldY: number): void {
    const prev = this.hoveredCharId
    const s = this.characterScale
    const chars = this.getCharacters()
    let bestId: number | null = null
    let bestY = -Infinity
    for (const ch of chars) {
      if (ch.matrixEffect === 'despawn') continue
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
      const anchorY = ch.y + sittingOffset
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH * s
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH * s
      const top = anchorY - CHARACTER_HIT_HEIGHT * s
      const bottom = anchorY
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        if (ch.y > bestY) { bestY = ch.y; bestId = ch.id }
      }
    }
    this.hoveredCharId = bestId
    if (this.hoveredCharId !== prev) this.markDirty()
  }

  // ── Update loop ───────────────────────────────────────────────

  update(dt: number): void {
    this.clock += dt
    let wake: number | null = null
    const wakeIn = (sec: number) => {
      if (Number.isFinite(sec) && sec >= 0 && (wake === null || sec < wake)) wake = sec
    }
    const toDelete: number[] = []
    for (const ch of this.characters.values()) {
      // Snapshot visual state before update
      const prevX = ch.x
      const prevY = ch.y
      const prevState = ch.state
      const prevFrame = ch.frame
      const prevDir = ch.dir
      const prevBubble = ch.bubbleType
      const prevSpeech = ch.speechText
      const prevMatrix = ch.matrixEffect
      const prevMatrixTimer = ch.matrixEffectTimer

      // Handle matrix effect animation
      if (ch.matrixEffect) {
        ch.matrixEffectTimer += dt
        if (ch.matrixEffectTimer >= MATRIX_EFFECT_DURATION) {
          if (ch.matrixEffect === 'spawn') {
            ch.matrixEffect = null
            ch.matrixEffectTimer = 0
            ch.matrixEffectSeeds = []
          } else {
            toDelete.push(ch.id)
          }
        }
        // Matrix effect always animates
        this.dirty = true
        continue
      }

      // Active character without a work seat — try to claim one
      if (ch.isActive && !ch.seatId && ch.state === CharacterState.IDLE) {
        const seatId = this.findFreeSeat(ch.seatRole)
        if (seatId) {
          const seat = this.seats.get(seatId)!
          seat.assigned = true
          ch.seatId = seatId
        }
      }

      if (this.choreo.isBusy(ch.id)) {
        // Hand-off walk (engine/choreography.ts) instead of the normal state machine
        this.choreo.update(ch, dt)
        this.dirty = true
        wakeIn(0)
      } else {
        // Temporarily unblock own seat so character can pathfind to it
        this.withOwnSeatUnblocked(ch, () =>
          updateCharacter(ch, dt, this.wanderTiles, this.seats, this.tileMap, this.blockedTiles, this.characterScale, () => this.findFreeRestSeat())
        )
        // Every working agent types on the same beat, so N typists still cost one redraw per frame
        if (ch.state === CharacterState.TYPE && ch.isActive) {
          ch.frame = Math.floor(this.clock / TYPE_FRAME_DURATION_SEC) % 2
        }
      }

      // Tick the received-paper flash
      if (ch.paperTimer && ch.paperTimer > 0) {
        ch.paperTimer -= dt
        if (ch.paperTimer <= 0) {
          ch.paperTimer = 0
          this.dirty = true
        } else {
          wakeIn(ch.paperTimer)
        }
      }

      // Tick bubble timer
      if (ch.bubbleType === 'waiting') {
        ch.bubbleTimer -= dt
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null
          ch.bubbleTimer = 0
        }
      }

      // Tick speech bubble timer
      if (ch.speechText) {
        ch.speechTimer -= dt
        if (ch.speechTimer <= 0) {
          ch.speechText = null
          ch.speechTimer = 0
        }
      }

      // Mark dirty if anything visual changed
      if (ch.x !== prevX || ch.y !== prevY ||
          ch.state !== prevState || ch.frame !== prevFrame || ch.dir !== prevDir ||
          ch.bubbleType !== prevBubble || ch.speechText !== prevSpeech ||
          ch.matrixEffect !== prevMatrix || ch.matrixEffectTimer !== prevMatrixTimer) {
        this.dirty = true
      }

      // When does this character next need an update? The loop sleeps until the
      // earliest one instead of ticking every frame (P1.4: idle scenes cost nothing).
      if (ch.state === CharacterState.WALK) wakeIn(0)
      else if (ch.state === CharacterState.TYPE) {
        if (ch.isActive) wakeIn(TYPE_FRAME_DURATION_SEC - (this.clock % TYPE_FRAME_DURATION_SEC))
        else if (ch.seatTimer > 0) wakeIn(ch.seatTimer)
      } else if (ch.state === CharacterState.IDLE) {
        if (ch.isActive && ch.seatId) wakeIn(0)
        else if (ch.restSeatId && ch.seatTimer > 0) wakeIn(ch.seatTimer)
        else wakeIn(Math.max(0, ch.wanderTimer))
      }
      if (ch.bubbleType === 'waiting' && ch.bubbleTimer > 0) wakeIn(ch.bubbleTimer)
      if (ch.speechText && ch.speechTimer > 0) wakeIn(ch.speechTimer)
    }

    // Subagent cues fade out on their own
    for (const [charId, left] of this.subagentCues) {
      const next = left - dt
      if (next <= 0 || !this.characters.has(charId)) {
        this.subagentCues.delete(charId)
        this.dirty = true
      } else {
        this.subagentCues.set(charId, next)
        wakeIn(next)
      }
    }
    this.nextWakeSec = wake

    // Remove characters that finished despawn
    if (toDelete.length > 0) {
      this.dirty = true
      this._charListDirty = true
    }
    for (const id of toDelete) {
      const agentId = this.charIdToAgentId.get(id)
      this.characters.delete(id)
      if (agentId) {
        this.agentIdToCharId.delete(agentId)
        this.charIdToAgentId.delete(id)
      }
    }
  }

  // ── Boss flow API (P1.4–P1.6) ─────────────────────────────────

  getCharIdOf(agentId: string): number | undefined {
    return this.agentIdToCharId.get(agentId)
  }

  /** Add the Boss (the human) at the Boss's desk, or remove it (null). */
  setBoss(agentId: string, info: { label: string; labelColor: string; palette: number; hueShift: number } | null): void {
    const existing = this.agentIdToCharId.get(agentId)
    if (!info) {
      if (existing !== undefined) this.removeCharacter(agentId)
      return
    }
    if (existing !== undefined) {
      const ch = this.characters.get(existing)
      if (ch) {
        ch.label = info.label
        ch.labelColor = info.labelColor
        this.markDirty()
      }
      return
    }
    const charId = this.nextCharId++
    this.agentIdToCharId.set(agentId, charId)
    this.charIdToAgentId.set(charId, agentId)
    const ch = createCharacter(charId, info.palette, null, null, info.hueShift, CharacterState.IDLE)
    ch.isBoss = true
    ch.label = info.label
    ch.labelColor = info.labelColor
    ch.matrixEffect = 'spawn'
    ch.matrixEffectTimer = 0
    ch.matrixEffectSeeds = matrixEffectSeeds()
    this.placeBoss(ch)
    this.characters.set(charId, ch)
    this._charListDirty = true
    this.markDirty()
  }

  /** Put a character on a seat right away (no walk). */
  private seatAt(ch: Character, seat: Seat, active: boolean): void {
    ch.path = []
    ch.moveProgress = 0
    ch.tileCol = seat.seatCol
    ch.tileRow = seat.seatRow
    ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2
    ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2
    ch.dir = seat.facingDir
    ch.state = CharacterState.TYPE
    ch.frame = 0
    ch.frameTimer = 0
    ch.seatTimer = active ? 0 : SEAT_REST_ON_SNAP_SEC
  }

  /** Seat the Boss at a "boss" chair; layouts without one get a fixed standing spot. */
  private placeBoss(ch: Character): void {
    let seat: Seat | undefined
    for (const s of this.seats.values()) {
      if (s.isBoss && (!s.assigned || s.uid === ch.seatId)) { seat = s; break }
    }
    ch.path = []
    ch.moveProgress = 0
    ch.frame = 0
    if (seat) {
      seat.assigned = true
      ch.seatId = seat.uid
      ch.tileCol = seat.seatCol
      ch.tileRow = seat.seatRow
      ch.dir = seat.facingDir
      ch.state = CharacterState.TYPE
      ch.seatTimer = Infinity
    } else {
      // Bottom-right-most walkable tile: out of the way, but reachable
      const spot = [...this.walkableTiles].sort((a, b) => (b.row - a.row) || (b.col - a.col))[0] ?? { col: 1, row: 1 }
      ch.seatId = null
      ch.tileCol = spot.col
      ch.tileRow = spot.row
      ch.dir = Direction.UP
      ch.state = CharacterState.IDLE
      ch.wanderTimer = Infinity
    }
    ch.x = ch.tileCol * TILE_SIZE + TILE_SIZE / 2
    ch.y = ch.tileRow * TILE_SIZE + TILE_SIZE / 2
  }

  /** Queue a hand-off walk for a character (no-op when the giver is not in the scene). */
  playHandoff(req: Omit<HandoffRequest, 'fromCharId' | 'toCharId'> & { fromAgentId: string; toAgentId: string }): boolean {
    const fromCharId = this.agentIdToCharId.get(req.fromAgentId)
    const toCharId = this.agentIdToCharId.get(req.toAgentId) ?? null
    if (fromCharId === undefined) {
      // No giver on screen: the recipient just shows the paper
      if (toCharId !== null) {
        const to = this.characters.get(toCharId)
        if (to) {
          to.paperTimer = 1.5
          this.say(to, req.bubbleText)
        }
      }
      req.resolve()
      this.markDirty()
      return false
    }
    this.choreo.enqueue({ fromCharId, toCharId, bubbleText: req.bubbleText, deadline: req.deadline, instant: req.instant, resolve: req.resolve })
    this.markDirty()
    return true
  }

  /** Finish every hand-off now and put everyone with a seat on it (reconnect, §7.7). */
  snapToSeats(): void {
    this.choreo.finishAll()
    for (const ch of this.characters.values()) {
      ch.carrying = false
      ch.paperTimer = 0
      if (ch.matrixEffect === 'despawn') continue
      const seat = ch.seatId ? this.seats.get(ch.seatId) : undefined
      if (!seat) continue
      if (ch.restSeatId) {
        const rs = this.seats.get(ch.restSeatId)
        if (rs) rs.assigned = false
        ch.restSeatId = null
      }
      ch.path = []
      ch.moveProgress = 0
      ch.tileCol = seat.seatCol
      ch.tileRow = seat.seatRow
      ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2
      ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2
      ch.dir = seat.facingDir
      ch.state = CharacterState.TYPE
      ch.frame = 0
      ch.seatTimer = ch.isBoss ? Infinity : ch.isActive ? 0 : SEAT_REST_ON_SNAP_SEC
    }
    this.markDirty()
  }

  /** Finish hand-offs instantly (tab hidden) without moving anyone else. */
  finishHandoffs(): void {
    if (!this.choreo.hasWork()) return
    this.choreo.finishAll()
    this.markDirty()
  }

  /**
   * The scene was paused (hidden tab, off-screen canvas) and runs again. Timers did not
   * advance meanwhile, but the daemon went on: skip any walk, and put agents that started
   * working while nobody looked straight at their desks instead of walking there late.
   */
  resumeAfterPause(): void {
    this.choreo.finishAll()
    for (const ch of this.characters.values()) {
      if (!ch.isActive || ch.matrixEffect || !ch.seatId) continue
      const seat = this.seats.get(ch.seatId)
      if (!seat || (ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow && ch.state === CharacterState.TYPE)) continue
      if (ch.restSeatId) {
        const rs = this.seats.get(ch.restSeatId)
        if (rs) rs.assigned = false
        ch.restSeatId = null
      }
      this.seatAt(ch, seat, true)
    }
    this.markDirty()
  }

  /** Show or hide the queue board next to a character (count 0 hides it). */
  setTaskBoard(agentId: string | null, count: number): void {
    const charId = agentId ? this.agentIdToCharId.get(agentId) : undefined
    const next = charId !== undefined && count > 0 ? { charId, count } : null
    if (next?.charId === this.taskBoard?.charId && next?.count === this.taskBoard?.count) return
    this.taskBoard = next
    if (!next) this.taskBoardRect = null
    this.markDirty()
  }

  /** Mini subagent sprite next to a character for a few seconds. */
  showSubagent(agentId: string, seconds: number): void {
    const charId = this.agentIdToCharId.get(agentId)
    if (charId === undefined) return
    this.subagentCues.set(charId, seconds)
    this.markDirty()
  }

  /** The Boss or the task board under a world position, if any. */
  getObjectAtPixel(worldX: number, worldY: number): SceneObjectId | null {
    const r = this.taskBoardRect ?? this.taskBoardFurnitureRect
    if (r && worldX >= r.x && worldX <= r.x + r.w && worldY >= r.y && worldY <= r.y + r.h) return 'task-board'
    return null
  }

  // ── Test helpers ─────────────────────────────────────────────

  /** Spawn test characters to fill all work seats (for layout testing) */
  spawnTestCharacters(): void {
    // Clear existing test characters
    this.clearTestCharacters()

    let idx = 0
    for (const [uid, seat] of this.seats) {
      if (seat.isRest || seat.isBoss || seat.assigned) continue
      const agentId = `__test_${idx}`
      const charId = this.nextCharId++
      this.agentIdToCharId.set(agentId, charId)
      this.charIdToAgentId.set(charId, agentId)

      const palette = idx % PALETTE_COUNT
      seat.assigned = true
      const ch = createCharacter(charId, palette, uid, seat, 0, CharacterState.TYPE)
      ch.isActive = true
      this.characters.set(charId, ch)
      idx++
    }
    this._charListDirty = true
    this.rebuildFurnitureInstances()
  }

  /** Remove all test characters */
  clearTestCharacters(): void {
    const toRemove: string[] = []
    for (const [agentId, charId] of this.agentIdToCharId) {
      if (!agentId.startsWith('__test_')) continue
      const ch = this.characters.get(charId)
      if (ch?.seatId) {
        const seat = this.seats.get(ch.seatId)
        if (seat) seat.assigned = false
      }
      this.characters.delete(charId)
      this.charIdToAgentId.delete(charId)
      toRemove.push(agentId)
    }
    for (const id of toRemove) this.agentIdToCharId.delete(id)
    if (toRemove.length > 0) {
      this._charListDirty = true
      this.rebuildFurnitureInstances()
    }
  }

  /** Check if test characters are active */
  hasTestCharacters(): boolean {
    for (const agentId of this.agentIdToCharId.keys()) {
      if (agentId.startsWith('__test_')) return true
    }
    return false
  }


  // ── Private helpers ───────────────────────────────────────────

  /** A free work seat for this role (zones decide when the layout has them). */
  private findFreeSeat(role?: SeatRole): string | null {
    return pickSeat(this.seats, role, this.zoned)
  }

  /** Find a free rest seat (sofa, etc.) for idle characters */
  findFreeRestSeat(): string | null {
    const restSeats = [...this.seats.entries()].filter(([, s]) => s.isRest && !s.assigned && s.zone !== 'boss_room')
    if (restSeats.length === 0) return null
    // Pick a random one
    const [uid] = restSeats[Math.floor(Math.random() * restSeats.length)]
    return uid
  }

  private pickDiversePalette(): { palette: number; hueShift: number } {
    const counts = new Array(PALETTE_COUNT).fill(0) as number[]
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue
      counts[ch.palette]++
    }
    const minCount = Math.min(...counts)
    const available: number[] = []
    for (let i = 0; i < PALETTE_COUNT; i++) {
      if (counts[i] === minCount) available.push(i)
    }
    const palette = available[Math.floor(Math.random() * available.length)]
    let hueShift = 0
    if (minCount > 0) {
      hueShift = HUE_SHIFT_MIN_DEG + Math.floor(Math.random() * HUE_SHIFT_RANGE_DEG)
    }
    return { palette, hueShift }
  }

  private ownSeatKey(ch: Character): string | null {
    if (!ch.seatId) return null
    const seat = this.seats.get(ch.seatId)
    if (!seat) return null
    return `${seat.seatCol},${seat.seatRow}`
  }

  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const key = this.ownSeatKey(ch)
    // Also unblock rest seat target if character is heading to one
    const restKey = ch.restSeatId ? (() => {
      const rs = this.seats.get(ch.restSeatId!)
      return rs ? `${rs.seatCol},${rs.seatRow}` : null
    })() : null
    if (key) this.blockedTiles.delete(key)
    if (restKey) this.blockedTiles.delete(restKey)
    const result = fn()
    if (key) this.blockedTiles.add(key)
    if (restKey) this.blockedTiles.add(restKey)
    return result
  }

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  private rebuildFurnitureInstances(): void {
    const autoOnTiles = new Set<string>()
    for (const ch of this.characters.values()) {
      if (!ch.isActive || !ch.seatId) continue
      const seat = this.seats.get(ch.seatId)
      if (!seat) continue
      const dCol = seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
        autoOnTiles.add(`${seat.seatCol + dCol * d},${seat.seatRow + dRow * d}`)
      }
      for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
        const baseCol = seat.seatCol + dCol * d
        const baseRow = seat.seatRow + dRow * d
        if (dCol !== 0) {
          autoOnTiles.add(`${baseCol},${baseRow - 1}`)
          autoOnTiles.add(`${baseCol},${baseRow + 1}`)
        } else {
          autoOnTiles.add(`${baseCol - 1},${baseRow}`)
          autoOnTiles.add(`${baseCol + 1},${baseRow}`)
        }
      }
    }

    if (autoOnTiles.size === 0) {
      this.furniture = layoutToFurnitureInstances(this.layout.furniture)
      return
    }

    const modifiedFurniture: PlacedFurniture[] = this.layout.furniture.map((item) => {
      const entry = getCatalogEntry(item.type)
      if (!entry) return item
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
            const onType = getOnStateType(item.type)
            if (onType !== item.type) {
              return { ...item, type: onType }
            }
            return item
          }
        }
      }
      return item
    })

    this.furniture = layoutToFurnitureInstances(modifiedFurniture)
  }
}
