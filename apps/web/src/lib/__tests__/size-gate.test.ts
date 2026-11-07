// The CI size gate (scripts/check-bundle-size.mjs) passes within the tolerance and fails above it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateBudget } from "../../../scripts/check-bundle-size.mjs";

const budget = { tolerance: 0.05, routes: { "/office": { firstLoadKb: 100, withLayoutKb: 120 } } };

describe("bundle size gate", () => {
  it("passes up to 5% over budget", () => {
    assert.equal(evaluateBudget(budget, { "/office": { firstLoadKb: 105, withLayoutKb: 120 } }).ok, true);
  });
  it("fails beyond the tolerance or when the route is missing", () => {
    assert.equal(evaluateBudget(budget, { "/office": { firstLoadKb: 105.1, withLayoutKb: 120 } }).ok, false);
    assert.equal(evaluateBudget(budget, { "/office": { firstLoadKb: 90, withLayoutKb: 127 } }).ok, false);
    assert.equal(evaluateBudget(budget, {}).ok, false);
  });
});
