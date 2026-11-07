// Theme packs (P6.3): every theme shipped in public/themes/ must load exactly as written.
// A contributed theme that fails here would be silently skipped or half-applied in the UI.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePaletteTheme, parseThemeIndex } from "../themes";

const themesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../../public/themes");
const readJson = (file: string): unknown => JSON.parse(readFileSync(join(themesDir, file), "utf8"));

describe("theme packs", () => {
  const rawIndex = readJson("index.json") as unknown[];
  const index = parseThemeIndex(rawIndex);

  it("index.json lists every theme with a valid, unique entry", () => {
    assert.ok(Array.isArray(rawIndex) && rawIndex.length > 0);
    assert.equal(index.length, rawIndex.length, "an index entry was rejected (bad id, name, file or a duplicate id)");
  });

  for (const entry of index) {
    it(`${entry.file} is a palette theme whose every value is used as written`, () => {
      assert.ok(existsSync(join(themesDir, entry.file)), `${entry.file} is missing`);
      const raw = readJson(entry.file) as { floors?: Record<string, unknown>; walls?: unknown; doors?: unknown };
      const theme = parsePaletteTheme(raw);
      assert.ok(theme, `${entry.file} is not a version 1 palette theme`);
      // parsePaletteTheme drops unknown zones and clamps values: a pack must not rely on that
      assert.deepEqual(theme, { version: 1, kind: "palette", ...(raw.walls ? { walls: raw.walls } : {}), ...(raw.doors ? { doors: raw.doors } : {}), ...(raw.floors ? { floors: raw.floors } : {}) });
    });
  }

  it("rejects index entries that point outside the themes folder or reuse an id", () => {
    const parsed = parseThemeIndex([
      { id: "a", name: "A", file: "a.json" },
      { id: "a", name: "A again", file: "a2.json" },
      { id: "b", name: "B", file: "../secret.json" },
      { id: "builtin", name: "Shadow", file: "c.json" },
      { id: "d", name: "D" },
    ]);
    assert.deepEqual(parsed.map((e) => e.id), ["a"]);
  });
});
