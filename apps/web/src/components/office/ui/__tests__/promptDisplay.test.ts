import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { describePrompt } from '../promptDisplay'

describe('describePrompt', () => {
  it('shows the Boss task instead of the dispatcher wrapper', () => {
    const raw = 'The Boss assigned you a task:\nBuild a snake game\nSplit it into sub-tasks for your developers, one per line:\n- TASK: <description>'
    assert.deepEqual(describePrompt(raw), { tag: 'boss', text: 'Boss: Build a snake game' })
  })

  it('summarizes a result batch for the Lead', () => {
    const raw = 'You are the Team Lead. You CANNOT write or fix code.\n\nOriginal user task: X\n\nTeam status:\n\n\nNew result from 2 team members (completed successfully):\n- Rex (completed successfully): Finished.\n\n- Mia (completed successfully): Done too.\n\nCRITICAL: Only ONE delegation per response.'
    const d = describePrompt(raw)
    assert.equal(d?.tag, 'results')
    assert.equal(d?.text, 'From 2 team members: Rex (completed successfully): Finished. · Mia (completed successfully): Done too.')
  })

  it('a single result keeps its summary', () => {
    const raw = 'You are the Team Lead. Rules.\n\nNew result from Sophie (completed):\nVERDICT: PASS\n\nCRITICAL: x'
    assert.deepEqual(describePrompt(raw), { tag: 'results', text: 'From Sophie: VERDICT: PASS' })
  })

  it('turns an [Assigned by …] wrapper into "Lead: task"', () => {
    const raw = '[Assigned by Marcus (Team Lead — Creative direction, planning)]\nBuild the core feature'
    assert.deepEqual(describePrompt(raw), { tag: 'task', text: 'Marcus: Build the core feature' })
  })

  it('finds the request at the end of a worker template', () => {
    const raw = `Your name is Rex, your role is Dev.\n\n${'Rules. '.repeat(40)}\n\n[Assigned by Marcus (Team Lead)]\nWrite tests`
    assert.deepEqual(describePrompt(raw), { tag: 'task', text: 'Marcus: Write tests' })
  })

  it('leaves text a person typed alone', () => {
    assert.equal(describePrompt('make the button blue'), null)
    assert.equal(describePrompt('You are great, thanks'), null)
  })
})
