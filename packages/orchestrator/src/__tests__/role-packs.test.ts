// Role packs (P6.3): every bundled agents/*.md must have the front matter Claude Code's
// --agent flag resolves by, and pack names must be unique.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listRolePacks, parseRolePack } from "../agent-defs.js";

describe("role packs", () => {
  it("every bundled pack parses and names are unique", () => {
    const { packs, invalid } = listRolePacks();
    assert.deepEqual(invalid, []);
    assert.ok(packs.length > 0);
    const names = packs.map((p) => p.name);
    assert.equal(new Set(names).size, names.length, `duplicate pack names: ${names.join(", ")}`);
  });

  it("reads name and description from the front matter only", () => {
    assert.deepEqual(
      parseRolePack("x.md", "---\nname: Code Reviewer\ndescription: \"Reviews code.\"\n---\n\n# Body\nname: ignored\n"),
      { file: "x.md", name: "Code Reviewer", description: "Reviews code." },
    );
    assert.equal(parseRolePack("x.md", "# No front matter\n"), null);
    assert.equal(parseRolePack("x.md", "---\nname: Only a name\n---\n"), null);
  });
});
