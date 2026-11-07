// P1.4 hand-off choreography: timing fits the daemon's duration, skip-ahead, queueing,
// instant mode. Runs on a fake clock and a tiny open floor; no DOM needed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Choreographer, HANDOFF_HOLD_MS, LATE_WALK_BUDGET_MS, MAX_WALK_PX_PER_SEC, type ChoreoHost, type HandoffRequest } from "../choreography";
import { createCharacter } from "../characters";
import { CharacterState, TileType, type Character, type Seat } from "../../types";

const FRAME = 1 / 60;

function setup(cols = 40, rows = 5) {
  const tileMap = Array.from({ length: rows }, () => Array.from({ length: cols }, () => TileType.FLOOR_1)) as TileType[][];
  const chars = new Map<number, Character>();
  const said: Array<{ id: number; text: string }> = [];
  let now = 0;
  const host: ChoreoHost = {
    tileMap,
    blockedTiles: new Set(),
    seats: new Map<string, Seat>(),
    characterScale: 1,
    getChar: (id) => chars.get(id),
    say: (ch, text) => said.push({ id: ch.id, text }),
    withOwnSeatUnblocked: (_ch, fn) => fn(),
    now: () => now,
  };
  const choreo = new Choreographer(host);
  const add = (id: number, col: number, row: number) => {
    const ch = createCharacter(id, 0, null, null, 0, CharacterState.IDLE);
    ch.tileCol = col;
    ch.tileRow = row;
    ch.x = col * 16 + 8;
    ch.y = row * 16 + 8;
    ch.wanderTimer = Infinity;
    chars.set(id, ch);
    return ch;
  };
  /** Advance the fake clock, updating every busy character each frame; returns state changes. */
  const run = (seconds: number, ids: number[]) => {
    const changes: Array<{ t: number; id: number; state: string }> = [];
    const last = new Map<number, string>();
    for (let t = 0; t < seconds; t += FRAME) {
      now += FRAME * 1000;
      for (const id of ids) {
        const ch = chars.get(id)!;
        if (choreo.isBusy(id)) choreo.update(ch, FRAME);
        if (last.get(id) !== ch.state) {
          changes.push({ t: now, id, state: ch.state });
          last.set(id, ch.state);
        }
      }
    }
    return changes;
  };
  const request = (from: number, to: number | null, durationMs: number, extra: Partial<HandoffRequest> = {}) => {
    let resolvedAt: number | null = null;
    const req: HandoffRequest = {
      fromCharId: from, toCharId: to, bubbleText: "paper", deadline: now + durationMs, instant: durationMs <= 0,
      resolve: () => { resolvedAt = now; }, ...extra,
    };
    choreo.enqueue(req);
    return { resolvedAt: () => resolvedAt };
  };
  return { choreo, add, run, request, said, now: () => now };
}

describe("hand-off choreography", () => {
  it("walk + hand-over end at the daemon's deadline, then the giver walks back", () => {
    const s = setup();
    const giver = s.add(1, 1, 2);
    s.add(2, 12, 2);
    const t0 = s.now();
    const r = s.request(1, 2, 2500);
    const changes = s.run(8, [1]);
    const arrive = changes.find((c) => c.state === CharacterState.HANDOFF)!;
    const ret = changes.find((c) => c.state === CharacterState.RETURN)!;
    assert.ok(arrive, "reached the recipient");
    // ~1.9 s walking, ~0.6 s handing over (owner decision §0.4)
    assert.ok(Math.abs(arrive.t - t0 - (2500 - HANDOFF_HOLD_MS)) < 120, `arrived at ${arrive.t - t0} ms`);
    assert.ok(Math.abs(r.resolvedAt()! - t0 - 2500) < 60, `handed over at ${r.resolvedAt()! - t0} ms`);
    assert.ok(ret.t >= r.resolvedAt()!);
    assert.equal(giver.tileCol, 1, "back where it started");
    assert.equal(giver.state, CharacterState.IDLE);
    assert.equal(giver.carrying, false);
  });

  it("a longer duration slows the walk down to fit", () => {
    const s = setup();
    s.add(1, 1, 2);
    s.add(2, 12, 2);
    const t0 = s.now();
    s.request(1, 2, 6000);
    const arrive = s.run(9, [1]).find((c) => c.state === CharacterState.HANDOFF)!;
    assert.ok(Math.abs(arrive.t - t0 - (6000 - HANDOFF_HOLD_MS)) < 120, `arrived at ${arrive.t - t0} ms`);
  });

  it("too far for the top speed: skips ahead, still on time, and returns to the real start", () => {
    const s = setup(80);
    const giver = s.add(1, 1, 2);
    s.add(2, 70, 2);
    const t0 = s.now();
    const r = s.request(1, 2, 1500);
    const changes = s.run(0.05, [1]);
    assert.equal(changes[0].state, CharacterState.WALK_TO);
    const tilesLeft = giver.path.length;
    assert.ok(tilesLeft * 16 <= MAX_WALK_PX_PER_SEC * 1.5, "remaining path fits the top speed");
    assert.ok(giver.tileCol > 1, "skipped ahead");
    s.run(30, [1]);
    assert.ok(Math.abs(r.resolvedAt()! - t0 - 1500) < 80);
    assert.equal(giver.tileCol, 1, "walked back to where it really started");
  });

  it("concurrent hand-offs from one giver play one after another, without walking home in between", () => {
    const s = setup();
    s.add(1, 1, 2);
    s.add(2, 10, 2);
    s.add(3, 20, 2);
    const t0 = s.now();
    const a = s.request(1, 2, 2000);
    const b = s.request(1, 3, 2000);
    const changes = s.run(15, [1]);
    assert.ok(a.resolvedAt()! < b.resolvedAt()!, "second waits for the first");
    // The second one is late (the daemon started that work at 2 s): a short, fast walk
    assert.ok(b.resolvedAt()! - t0 <= 2000 + LATE_WALK_BUDGET_MS + 100, `second handed over at ${b.resolvedAt()! - t0} ms`);
    const states = changes.map((c) => c.state);
    assert.deepEqual(states.filter((x) => x !== CharacterState.IDLE), [
      CharacterState.WALK_TO, CharacterState.HANDOFF, CharacterState.WALK_TO, CharacterState.HANDOFF, CharacterState.RETURN,
    ]);
  });

  it("instant mode (duration 0, no path, recipient missing) shows a bubble and moves nobody", () => {
    const s = setup();
    const giver = s.add(1, 1, 2);
    const to = s.add(2, 12, 2);
    const r = s.request(1, 2, 0);
    s.run(0.1, [1]);
    assert.notEqual(r.resolvedAt(), null);
    assert.equal(giver.tileCol, 1);
    assert.ok((to.paperTimer ?? 0) > 0, "the recipient flashes the paper");
    assert.deepEqual(s.said.map((x) => x.id), [1]);
    const missing = s.request(1, null, 2500);
    s.run(0.1, [1]);
    assert.notEqual(missing.resolvedAt(), null);
  });

  it("finishAll resolves everything and puts the giver back (reconnect, hidden tab)", () => {
    const s = setup();
    const giver = s.add(1, 1, 2);
    s.add(2, 12, 2);
    const a = s.request(1, 2, 3000);
    const b = s.request(1, 2, 3000);
    s.run(1, [1]);
    assert.ok(giver.tileCol > 1);
    s.choreo.finishAll();
    assert.notEqual(a.resolvedAt(), null);
    assert.notEqual(b.resolvedAt(), null);
    assert.equal(giver.tileCol, 1);
    assert.equal(s.choreo.hasWork(), false);
  });
});
