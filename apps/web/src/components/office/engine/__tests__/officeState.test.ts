// Phase 3: role-based desks in the default office, typing for working agents, and an
// office with nobody working that asks for no frames at all.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { OfficeState } from '../officeState'
import { CharacterState } from '../../types'
import { TYPE_FRAME_DURATION_SEC } from '../../constants'

function run(o: OfficeState, seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds; t += step) o.update(step)
}

function hire(o: OfficeState, id: string, role: 'lead' | 'reviewer' | 'dev') {
  o.addCharacter(id, id, 0, false, id, '#888', role)
  o.updateCharacterStatus(id, 'idle', true)
  return o.characters.get(o.getCharIdOf(id)!)!
}

describe('OfficeState in the default office', () => {
  it('seats the Lead, the reviewer and devs by zone, straight at their desks', () => {
    const o = new OfficeState()
    const dev = hire(o, 'd1', 'dev')
    const lead = hire(o, 'l', 'lead')
    const rev = hire(o, 'r', 'reviewer')
    assert.equal(lead.seatId, 'lead-chair')
    assert.equal(rev.seatId, 'review-chair')
    assert.equal(dev.seatId, 'dev-chair-1')
    assert.equal(dev.state, CharacterState.TYPE, 'a new team member starts at its desk')
  })

  it('moves an agent whose role changes to a fitting desk', () => {
    const o = new OfficeState()
    const a = hire(o, 'a', 'dev')
    assert.equal(a.seatId, 'dev-chair-1')
    o.setSeatRole('a', 'lead')
    assert.equal(a.seatId, 'lead-chair')
  })

  it('working agents type on a shared low-rate beat; idle desks ask for no frames', () => {
    const o = new OfficeState()
    const devs = ['d1', 'd2', 'd3'].map((id) => hire(o, id, 'dev'))
    run(o, 1)
    for (const id of ['d1', 'd2', 'd3']) o.updateCharacterStatus(id, 'working', true)
    const frames = new Set<string>()
    let wakes = 0
    for (let i = 0; i < 120; i++) {
      o.update(1 / 60)
      frames.add(devs.map((d) => d.frame).join(''))
      if (o.nextWakeSec !== null && o.nextWakeSec > 0) wakes++
      assert.ok(o.nextWakeSec !== null && o.nextWakeSec <= TYPE_FRAME_DURATION_SEC + 1e-9)
    }
    assert.deepEqual([...frames].sort(), ['000', '111'], 'all typists switch frames together')
    assert.ok(devs.every((d) => d.state === CharacterState.TYPE && d.isActive))

    for (const id of ['d1', 'd2', 'd3']) o.updateCharacterStatus(id, 'idle', true)
    o.update(1 / 60)
    assert.ok(devs.every((d) => d.frame === 0), 'idle agents sit still')
    // Seated idle agents only need a wake-up when their rest timer runs out (a minute away)
    assert.ok(o.nextWakeSec === null || o.nextWakeSec > 30, `next wake ${o.nextWakeSec}`)
    assert.ok(wakes > 0)
  })

  it('after a pause, agents that started working meanwhile sit at their desks at once', () => {
    const o = new OfficeState()
    const dev = hire(o, 'd1', 'dev')
    run(o, 2) // spawn effect done
    const seat = o.seats.get(dev.seatId!)!
    // Away from the desk (wandering), then the daemon says it works while the tab was hidden
    dev.state = CharacterState.IDLE
    dev.tileCol = seat.seatCol + 3
    dev.x += 3 * 16
    o.updateCharacterStatus('d1', 'working', true)
    o.resumeAfterPause()
    assert.equal(dev.tileCol, seat.seatCol)
    assert.equal(dev.tileRow, seat.seatRow)
    assert.equal(dev.state, CharacterState.TYPE)
  })
})
