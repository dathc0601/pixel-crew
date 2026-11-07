# Extending Pixel Crew

Pixel Crew has four extension points. Three of them work today. The fourth, driver profiles, is the plan for multi-vendor support (Phase 2).

| Extension point | What you add | Code? | Where |
|---|---|---|---|
| [Theme packs](#theme-packs) | A palette that recolors the office | No, JSON only | `apps/web/public/themes/` |
| [Role packs](#role-packs) | A Claude Code agent profile for a role | No, Markdown only | `packages/orchestrator/agents/*.md` |
| [Scene adapters](#scene-adapters) | A different way to draw the office | Yes, TypeScript | `apps/web/src/components/office/scene/` |
| [Driver profiles](#driver-profiles-planned) | Support for another AI CLI | Yes, TypeScript | today `apps/gateway/src/backends.ts`; later `packages/orchestrator/src/drivers/` |

Every pack that ships in the repo is checked by a test, so CI catches a broken one.

---

## Theme packs

A theme pack recolors the built-in floor plan zone by zone. It is data only, with no scripts and no images. That makes it safe to accept from anyone. The UI fetches it only when someone picks it in the office switcher.

**1. Add the theme file** `apps/web/public/themes/<id>.json`:

```json
{
  "version": 1,
  "kind": "palette",
  "walls": { "h": 250, "s": 22, "b": -58, "c": 0 },
  "doors": { "h": 30, "s": 30, "b": -30, "c": 0, "colorize": true },
  "floors": {
    "boss_room": { "h": 280, "s": 30, "b": -40, "c": 10, "colorize": true },
    "lead_area": { "h": 225, "s": 35, "b": -38, "c": 0, "colorize": true },
    "dev_area":  { "h": 240, "s": 10, "b": -30, "c": 0, "colorize": true },
    "meeting":   { "h": 170, "s": 25, "b": -36, "c": 0, "colorize": true },
    "pantry":    { "h": 190, "s": 22, "b": -34, "c": 0, "colorize": true }
  }
}
```

- Each color is a `FloorColor` (`apps/web/src/components/office/types.ts`), the same values the layout editor's floor painter uses:
  - with `"colorize": true`: `h` 0–360 and `s` 0–100;
  - without it, the color adjusts the tile: `h` −180–180 and `s` −100–100;
  - `b` (brightness) and `c` (contrast) are −100–100.
- The zone keys are the layout zones: `boss_room`, `lead_area`, `dev_area`, `meeting` and `pantry`. Any key you leave out keeps its default color.

**2. List it** in `apps/web/public/themes/index.json`:

```json
{ "id": "night-shift", "name": "Night Shift", "file": "night-shift.json", "swatch": ["#3a3350", "#24304f", "#4b4a5c", "#2f4a4a"] }
```

- `id` must be unique and must not be `builtin`.
- `file` must be a plain `*.json` name in the same folder, without a path.
- `swatch` is optional: two to four colors for the preview tile.

**3. Check it**: `pnpm --filter web test`. The test is `layout/__tests__/themes.test.ts`. It fails when an index entry would be skipped, or when a value would be dropped or clamped at load time.

Code: `apps/web/src/components/office/layout/themes.ts` (`parseThemeIndex`, `parsePaletteTheme`, `applyPaletteTheme`).

> Image-based themes (background pictures) are not accepted. Only art with a clear CC0, MIT or own-work license can ship, and every asset is recorded in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

---

## Role packs

A role pack is a [Claude Code subagent](https://docs.claude.com/en/docs/claude-code/sub-agents) profile. At startup the gateway copies the bundled packs into `~/.claude/agents/`. When a hired agent's role title matches a pack's `name`, Pixel Crew runs it with `claude --agent "<name>"`. The role title is the part of the role before ` — `, for example `Code Reviewer` in `Code Reviewer — Code review, bugs, security, quality`.

**1. Add** `packages/orchestrator/agents/<slug>.md`:

```markdown
---
name: Data Engineer
description: Pipelines, schemas and data quality; prefers boring, testable SQL.
---

# Data Engineer

What this role focuses on, how it works, and what it hands back.
Keep it short: it is added to every task this agent runs.
```

- `name` and `description` are required, on one line each. `name` must be unique across packs.
- The pack only takes effect for an agent whose role title is exactly `name`. Hire one with that role, or add an agent definition in `~/.pixel-crew/data/agents.json`. The `AgentDefinition` type is in `packages/shared/src/agent-defs.ts`.
- The Team Lead never runs with a pack, because its prompt and tool policy come from the daemon (`lead-policy.ts`).

**2. Check it**: `pnpm --filter @pixel-crew/orchestrator test`. The test is `role-packs.test.ts`.

Code: `packages/orchestrator/src/agent-defs.ts` (`parseRolePack`, `listRolePacks`, `syncAgentDefs`).

---

## Scene adapters

The office view is drawn behind a `SceneAdapter` interface (`apps/web/src/components/office/scene/SceneAdapter.ts`). The pixel office is one implementation. A list view, an isometric or a 3D scene could replace it without touching the store or the protocol. `useSceneBridge` feeds the adapter from the store. Agents, statuses, speech bubbles and Boss-flow hand-offs all reach it as method calls.

- **Required**: `addAgent`, `removeAgent`, `updateAgent`, `showSpeechBubble`, `selectAgent`, `dispose`, `playHandoff` (the Boss → Lead → dev walk) and `setBoss`.
- **Optional**: `setTaskBoard`, `showSubagent`, `snapToSeats`, `setSeatRole` and `setObjectClickHandler`.
- The choreography is cosmetic. The daemon owns all timing, and `playHandoff` must resolve even when nothing can be animated.

Step by step: [`apps/web/src/components/office/scene/README.md`](../apps/web/src/components/office/scene/README.md).

---

## Driver profiles (planned)

v1 runs Claude Code only. Today each AI CLI is an `AIBackend` entry in `apps/gateway/src/backends.ts`. The entry holds the command, the argument builder and capability flags; the type lives in `packages/orchestrator/src/ai-backend.ts`. Phase 2 replaces this with an `AgentDriver` interface and makes ACP the default for new vendors.

The design, the vendor list and the projects to port from are in [`docs/adding-a-vendor.md`](adding-a-vendor.md).
