import { MAX_DELTA_TIME_SEC } from '../constants'

/** Number of consecutive clean frames before the loop sleeps */
const IDLE_THRESHOLD = 10

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
}

/** Frame counters for performance checks (read them from the devtools console). */
export interface GameLoopStats {
  /** rAF callbacks run */
  ticks: number
  /** Frames actually drawn */
  renders: number
  sleeping: boolean
}

declare global {
  interface Window {
    __pixelCrewLoop?: GameLoopStats
  }
}

/** Sleep after a single clean frame when the next timer is at least this far away */
const EARLY_SLEEP_MIN_MS = 40

/** Longest gap a timer wake-up may cover in one update (timers only; nothing walks while asleep) */
const MAX_SLEEP_DELTA_SEC = 600

export function startGameLoop(
  canvas: HTMLCanvasElement,
  callbacks: GameLoopCallbacks,
): { stop: () => void; wake: () => void } {
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  let lastTime = 0
  let rafId = 0
  let stopped = false
  /** Force render on first frame and after resize */
  let forceRender = true
  /** Consecutive frames with no dirty state */
  let idleFrames = 0
  /** Whether the loop is currently sleeping (no rAF scheduled) */
  let sleeping = false
  /** rAF time at which the loop went to sleep (0 = not asleep) */
  let sleptAt = 0
  let wakeTimer: ReturnType<typeof setTimeout> | null = null
  const stats: GameLoopStats = { ticks: 0, renders: 0, sleeping: false }
  if (typeof window !== 'undefined') window.__pixelCrewLoop = stats

  // Mark dirty on resize so the scene redraws at new dimensions
  const ro = new ResizeObserver(() => {
    forceRender = true
    wake()
  })
  ro.observe(canvas)

  const frame = (time: number) => {
    if (stopped) return
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
      callbacks.render(ctx)
      stats.renders++
    } else {
      idleFrames++
    }

    // Sleep when idle — events will wake us via wake(). A known timer far enough away
    // (typing frames, wander pauses) lets the loop sleep right after one clean frame, so a
    // typing dev costs about one tick per typing frame instead of a burst of rAF ticks.
    const timerMs = idleFrames > 0 ? (callbacks.nextWakeMs?.() ?? null) : null
    if (idleFrames >= IDLE_THRESHOLD || (timerMs !== null && timerMs > EARLY_SLEEP_MIN_MS)) {
      const wakeIn = timerMs ?? callbacks.nextWakeMs?.() ?? null
      if (wakeIn !== null && wakeIn <= 0) {
        // Something needs per-frame updates without drawing (rare); keep ticking
        rafId = requestAnimationFrame(frame)
        return
      }
      sleeping = true
      stats.sleeping = true
      sleptAt = time
      lastTime = 0
      if (wakeIn !== null) {
        wakeTimer = setTimeout(() => {
          wakeTimer = null
          wake()
        }, Math.ceil(wakeIn))
      }
      return
    }

    rafId = requestAnimationFrame(frame)
  }

  /** Wake the loop from sleep. Safe to call even when already running. */
  function wake() {
    if (stopped) return
    if (wakeTimer) {
      clearTimeout(wakeTimer)
      wakeTimer = null
    }
    if (!sleeping) {
      // Already running — just reset idle counter so we don't sleep soon
      idleFrames = 0
      return
    }
    sleeping = false
    idleFrames = 0
    rafId = requestAnimationFrame(frame)
  }

  rafId = requestAnimationFrame(frame)

  return {
    stop: () => {
      stopped = true
      cancelAnimationFrame(rafId)
      if (wakeTimer) clearTimeout(wakeTimer)
      ro.disconnect()
    },
    wake,
  }
}
