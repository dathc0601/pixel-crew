// Phone layout: overlays registered as scene insets define the band the map is fitted into.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { measureSceneInsets, onSceneInsetsChange, registerSceneInset } from "../sceneInsets";

function fakeEl(top: number, bottom: number, width = 390): Element {
  return { getBoundingClientRect: () => ({ top, bottom, height: bottom - top, width }) } as unknown as Element;
}

const AREA = { top: 0, bottom: 844, height: 844 };

describe("scene insets", () => {
  it("measures how far top and bottom overlays reach into the canvas", () => {
    const offs = [
      registerSceneInset(fakeEl(0, 45), "top"),
      registerSceneInset(fakeEl(715, 790), "bottom"),
      registerSceneInset(fakeEl(780, 844), "bottom"),
    ];
    assert.deepEqual(measureSceneInsets(AREA), { top: 45, bottom: 129 });
    for (const off of offs) off();
    assert.deepEqual(measureSceneInsets(AREA), { top: 0, bottom: 0 });
  });

  it("ignores hidden overlays and caps each side at a third of the height", () => {
    const offs = [
      registerSceneInset(fakeEl(0, 0, 0), "top"),
      registerSceneInset(fakeEl(100, 844), "bottom"),
    ];
    assert.deepEqual(measureSceneInsets(AREA), { top: 0, bottom: Math.round(844 / 3) });
    for (const off of offs) off();
  });

  it("notifies listeners when overlays come and go", () => {
    let calls = 0;
    const stop = onSceneInsetsChange(() => { calls++; });
    const off = registerSceneInset(fakeEl(0, 40), "top");
    off();
    stop();
    registerSceneInset(fakeEl(0, 40), "top")();
    assert.equal(calls, 2);
  });
});
