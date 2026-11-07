// P4.1: the loop ticks only when needed, caps continuous animation at 30 fps, and pauses
// completely for a hidden tab or an off-screen canvas.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { startGameLoop, type LoopEnv } from '../gameLoop'

/** A 60 Hz display with timers on the same virtual clock. */
function fakeEnv() {
  let now = 0
  let vsyncs = 0
  let nextId = 1
  const rafs = new Map<number, (t: number) => void>()
  const timers = new Map<number, { at: number; cb: () => void }>()
  const listeners = new Set<() => void>()
  let ioCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }
  class FakeIO {
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) { ioCallback = cb }
    observe() {}
    disconnect() {}
  }
  const env: LoopEnv = {
    requestAnimationFrame: (cb) => { const id = nextId++; rafs.set(id, cb); return id },
    cancelAnimationFrame: (id) => { rafs.delete(id) },
    setTimeout: (cb, ms) => { const id = nextId++; timers.set(id, { at: now + ms, cb }); return id },
    clearTimeout: (id) => { timers.delete(id as number) },
    now: () => now,
    document: doc as unknown as LoopEnv['document'],
    IntersectionObserver: FakeIO as unknown as typeof IntersectionObserver,
  }
  /** Advance the clock vsync by vsync, firing due timers and pending rAF callbacks. */
  const advance = (ms: number) => {
    const end = now + ms
    while (now < end - 1e-9) {
      const vsync = Math.min(end, ++vsyncs * (1000 / 60))
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= vsync).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = Math.max(now, due[1].at)
        due[1].cb()
      }
      now = vsync
      const cbs = [...rafs.values()]
      rafs.clear()
      for (const cb of cbs) cb(now)
    }
  }
  const setHidden = (hidden: boolean) => {
    doc.visibilityState = hidden ? 'hidden' : 'visible'
    for (const cb of listeners) cb()
  }
  const setOnScreen = (on: boolean) => ioCallback?.([{ isIntersecting: on }])
  return { env, advance, setHidden, setOnScreen, pending: () => rafs.size + timers.size }
}

const canvas = { getContext: () => ({ imageSmoothingEnabled: false }) } as unknown as HTMLCanvasElement

describe('game loop scheduling', () => {
  it('a typing-only scene ticks once per typing frame, not every vsync', () => {
    const f = fakeEnv()
    let clock = 0
    let frame = -1
    let dirty = false
    const loop = startGameLoop(canvas, {
      update: (dt) => {
        clock += dt
        const next = Math.floor(clock / 0.14) % 2
        if (next !== frame) { frame = next; dirty = true }
      },
      render: () => {},
      isDirty: () => { const d = dirty; dirty = false; return d },
      nextWakeMs: () => (0.14 - (clock % 0.14)) * 1000,
    }, { env: f.env })
    f.advance(1000)
    const { ticks, renders } = loop.stats
    f.advance(3000)
    const t = loop.stats.ticks - ticks
    const r = loop.stats.renders - renders
    assert.ok(r >= 20 && r <= 23, `renders ${r}`)
    assert.ok(t <= r + 1, `ticks ${t} vs renders ${r}`)
    loop.stop()
  })

  it('caps continuous animation at 30 fps', () => {
    const f = fakeEnv()
    const loop = startGameLoop(canvas, {
      update: () => {},
      render: () => {},
      isDirty: () => true,
      nextWakeMs: () => 0,
    }, { env: f.env })
    f.advance(3000)
    assert.ok(loop.stats.ticks >= 88 && loop.stats.ticks <= 92, `ticks ${loop.stats.ticks}`)
    assert.ok(loop.stats.rafCallbacks > loop.stats.ticks, 'skipped vsyncs are cheap callbacks')
    loop.stop()
  })

  it('a scene with nothing pending sleeps and asks for no frames', () => {
    const f = fakeEnv()
    const loop = startGameLoop(canvas, {
      update: () => {},
      render: () => {},
      isDirty: () => false,
      nextWakeMs: () => null,
    }, { env: f.env })
    f.advance(1000)
    const ticks = loop.stats.ticks
    f.advance(3000)
    assert.equal(loop.stats.ticks, ticks)
    assert.equal(f.pending(), 0)
    loop.wake()
    f.advance(100)
    assert.ok(loop.stats.ticks > ticks, 'wake() runs it again')
    loop.stop()
  })

  for (const [name, hide, show] of [
    ['a hidden tab', (f: ReturnType<typeof fakeEnv>) => f.setHidden(true), (f: ReturnType<typeof fakeEnv>) => f.setHidden(false)],
    ['an off-screen canvas', (f: ReturnType<typeof fakeEnv>) => f.setOnScreen(false), (f: ReturnType<typeof fakeEnv>) => f.setOnScreen(true)],
  ] as const) {
    it(`pauses completely for ${name} and resumes without catch-up`, () => {
      const f = fakeEnv()
      const dts: number[] = []
      let paused = 0
      let resumedAfter = -1
      const loop = startGameLoop(canvas, {
        update: (dt) => dts.push(dt),
        render: () => {},
        isDirty: () => true,
        nextWakeMs: () => 0,
        onPause: () => paused++,
        onResume: (ms) => { resumedAfter = ms },
      }, { env: f.env })
      f.advance(500)
      hide(f)
      assert.equal(paused, 1)
      assert.ok(loop.isPaused())
      const ticks = loop.stats.ticks
      loop.wake()
      f.advance(10_000)
      assert.equal(loop.stats.ticks, ticks, 'nothing runs while paused')
      assert.equal(f.pending(), 0, 'no rAF or timer is left scheduled')
      dts.length = 0
      show(f)
      assert.ok(resumedAfter >= 10_000)
      f.advance(200)
      assert.ok(dts.length > 0)
      assert.ok(Math.max(...dts) <= 0.1, `no dt covers the paused time: ${Math.max(...dts)}`)
      loop.stop()
    })
  }
})
