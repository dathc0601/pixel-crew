import { MAX_DELTA_TIME_SEC } from '../constants'

/** Number of consecutive clean frames before the loop sleeps when no timer is pending */
const IDLE_THRESHOLD = 10

/** Frame cap while something moves (walks, spawn effects); sprites animate at 6-8 fps anyway */
export const MAX_FPS = 30

/** Phones and tablets (§9 budget: 15 fps on mobile / battery saver) */
export const MOBILE_MAX_FPS = 15

/**
 * Frame cap for this device: 15 fps on touch-first screens (coarse pointer, no hover) or
 * when the user asked to save data; 30 fps otherwise. Walk speed is time-based, so a lower
 * cap only makes motion a little steppier.
 */
export function deviceMaxFps(matches: (query: string) => boolean = (q) => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches): number {
  if (matches('(pointer: coarse) and (hover: none)')) return MOBILE_MAX_FPS
  if (matches('(prefers-reduced-data: reduce)')) return MOBILE_MAX_FPS
  return MAX_FPS
}

/** A vsync this much early still counts as on time (60 Hz frames are 16.7 ms apart) */
const FRAME_SLACK_MS = 4

export interface GameLoopCallbacks {
  update: (dt: number) => void
  render: (ctx: CanvasRenderingContext2D) => void
  /** Optional: return true if the scene needs re-rendering this frame */
  isDirty?: () => boolean
  /**
   * Optional: milliseconds until update() must run again while nothing is dirty
   * (timers counting down). 0 = keep ticking every frame; null = sleep until wake().
   * The loop sleeps in between with a single timeout instead of an always-on rAF.
   */
  nextWakeMs?: () => number | null
  /** The loop stopped for a hidden tab or an off-screen canvas */
  onPause?: () => void
  /** The loop runs again after a pause of pausedMs (timers do not catch up on it) */
  onResume?: (pausedMs: number) => void
}

/** Frame counters for performance checks (read them from the devtools console). */
export interface GameLoopStats {
  /** Updates run (one per frame that did work) */
  ticks: number
  /** Frames actually drawn */
  renders: number
  /** rAF callbacks, including vsyncs skipped by the frame cap */
  rafCallbacks: number
  /** Total time spent in render(), in ms */
  renderMs: number
  sleeping: boolean
  /** Hidden tab or off-screen canvas: nothing runs */
  paused: boolean
}

declare global {
  interface Window {
    __pixelCrewLoop?: GameLoopStats
  }
}

/** Sleep right after a frame when the next timer is at least this far away */
const EARLY_SLEEP_MIN_MS = 40

/** Longest gap a timer wake-up may cover in one update (timers only; nothing walks while asleep) */
const MAX_SLEEP_DELTA_SEC = 600

/** Browser hooks the loop uses; tests pass fakes. */
export interface LoopEnv {
  requestAnimationFrame: (cb: (time: number) => void) => number
  cancelAnimationFrame: (id: number) => void
  setTimeout: (cb: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
  now: () => number
  /** Visibility source (document); omit to never pause for a hidden tab */
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>
  ResizeObserver?: typeof ResizeObserver
  IntersectionObserver?: typeof IntersectionObserver
}

function browserEnv(): LoopEnv {
  return {
    requestAnimationFrame: (cb) => requestAnimationFrame(cb),
    cancelAnimationFrame: (id) => cancelAnimationFrame(id),
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    now: () => performance.now(),
    document: typeof document !== 'undefined' ? document : undefined,
    ResizeObserver: typeof ResizeObserver !== 'undefined' ? ResizeObserver : undefined,
    IntersectionObserver: typeof IntersectionObserver !== 'undefined' ? IntersectionObserver : undefined,
  }
}

export interface GameLoopHandle {
  stop: () => void
  /** Wake the loop from sleep. Safe to call even when already running. */
  wake: () => void
  /** True while the tab is hidden or the canvas is off-screen */
  isPaused: () => boolean
  stats: GameLoopStats
}

export function startGameLoop(
  canvas: HTMLCanvasElement,
  callbacks: GameLoopCallbacks,
  opts: { maxFps?: number; env?: LoopEnv } = {},
): GameLoopHandle {
  const env = opts.env ?? browserEnv()
  const minFrameMs = 1000 / (opts.maxFps ?? MAX_FPS)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  let lastTime = 0
  let rafId = 0
  let rafPending = false
  let stopped = false
  /** Force render on first frame and after resize */
  let forceRender = true
  /** Consecutive frames with no dirty state */
  let idleFrames = 0
  /** Whether the loop is currently sleeping (no rAF scheduled) */
  let sleeping = false
  /** rAF time at which the loop went to sleep (0 = not asleep) */
  let sleptAt = 0
  let wakeTimer: unknown = null
  /** Why the loop is paused ('hidden', 'offscreen'); empty = running */
  const pauseReasons = new Set<string>()
  let pausedAt = 0
  const stats: GameLoopStats = { ticks: 0, renders: 0, rafCallbacks: 0, renderMs: 0, sleeping: false, paused: false }
  if (typeof window !== 'undefined') window.__pixelCrewLoop = stats

  const schedule = () => {
    if (rafPending || stopped || pauseReasons.size > 0) return
    rafPending = true
    rafId = env.requestAnimationFrame(frame)
  }

  const clearWakeTimer = () => {
    if (wakeTimer !== null) {
      env.clearTimeout(wakeTimer)
      wakeTimer = null
    }
  }

  const frame = (time: number) => {
    rafPending = false
    if (stopped || pauseReasons.size > 0) return
    stats.rafCallbacks++
    // Frame cap while animating continuously: skip vsyncs that come too soon
    if (sleptAt === 0 && lastTime > 0 && !forceRender && time - lastTime < minFrameMs - FRAME_SLACK_MS) {
      schedule()
      return
    }
    sleeping = false
    stats.sleeping = false
    stats.ticks++
    let dt: number
    if (sleptAt > 0) {
      // First frame after sleeping: timers catch up on the whole gap
      dt = Math.min(Math.max(0, (time - sleptAt) / 1000), MAX_SLEEP_DELTA_SEC)
      sleptAt = 0
    } else {
      dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, MAX_DELTA_TIME_SEC)
    }
    lastTime = time

    callbacks.update(dt)

    // Only render when something changed
    const dirty = forceRender || !callbacks.isDirty || callbacks.isDirty()
    if (dirty) {
      idleFrames = 0
      forceRender = false
      ctx.imageSmoothingEnabled = false
      const t0 = env.now()
      callbacks.render(ctx)
      stats.renderMs += env.now() - t0
      stats.renders++
    } else {
      idleFrames++
    }

    // Sleep when nothing needs per-frame updates; events wake us via wake(). A known timer
    // far enough away (typing frames, wander pauses) puts the loop to sleep right after
    // this frame, so a typing dev costs one tick per typing frame and nothing in between.
    const wakeIn = callbacks.nextWakeMs?.() ?? null
    const timerFarAway = wakeIn !== null && wakeIn > EARLY_SLEEP_MIN_MS
    const nothingPending = wakeIn === null && idleFrames >= IDLE_THRESHOLD
    if (timerFarAway || nothingPending) {
      sleeping = true
      stats.sleeping = true
      sleptAt = time
      lastTime = 0
      if (wakeIn !== null) {
        wakeTimer = env.setTimeout(() => {
          wakeTimer = null
          wake()
        }, Math.ceil(wakeIn))
      }
      return
    }

    schedule()
  }

  function wake() {
    if (stopped) return
    clearWakeTimer()
    if (pauseReasons.size > 0) return
    if (!sleeping) {
      // Already running — just reset idle counter so we don't sleep soon
      idleFrames = 0
      return
    }
    sleeping = false
    idleFrames = 0
    schedule()
  }

  function setPaused(reason: string, on: boolean) {
    if (stopped || pauseReasons.has(reason) === on) return
    const wasPaused = pauseReasons.size > 0
    if (on) pauseReasons.add(reason)
    else pauseReasons.delete(reason)
    const isPaused = pauseReasons.size > 0
    if (isPaused === wasPaused) return
    stats.paused = isPaused
    if (isPaused) {
      clearWakeTimer()
      if (rafPending) env.cancelAnimationFrame(rafId)
      rafPending = false
      pausedAt = env.now()
      callbacks.onPause?.()
      return
    }
    // Resume: no catch-up for the paused time (walks would jump, timers would all fire at once)
    const pausedMs = env.now() - pausedAt
    sleeping = false
    sleptAt = 0
    lastTime = 0
    idleFrames = 0
    forceRender = true
    callbacks.onResume?.(pausedMs)
    schedule()
  }

  // Mark dirty on resize so the scene redraws at new dimensions
  const ro = env.ResizeObserver ? new env.ResizeObserver(() => {
    forceRender = true
    wake()
  }) : null
  ro?.observe(canvas)

  // Nothing runs while the canvas is scrolled away or hidden (display: none counts too)
  const io = env.IntersectionObserver ? new env.IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1]
    if (entry) setPaused('offscreen', !entry.isIntersecting)
  }) : null
  io?.observe(canvas)

  const doc = env.document
  const onVisibility = () => setPaused('hidden', doc?.visibilityState === 'hidden')
  doc?.addEventListener('visibilitychange', onVisibility)
  if (doc?.visibilityState === 'hidden') setPaused('hidden', true)

  schedule()

  return {
    stop: () => {
      stopped = true
      if (rafPending) env.cancelAnimationFrame(rafId)
      rafPending = false
      clearWakeTimer()
      ro?.disconnect()
      io?.disconnect()
      doc?.removeEventListener('visibilitychange', onVisibility)
    },
    wake,
    isPaused: () => pauseReasons.size > 0,
    stats,
  }
}
