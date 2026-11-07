/**
 * Role packs: curated, compact agent profiles bundled in packages/orchestrator/agents/*.md.
 *
 * They reach Claude Code per run, never through the user's ~/.claude/: the gateway writes
 * them as one JSON object to a Pixel Crew-owned file (see writeClaudeAgentsFile) and the
 * Claude backend passes `--agents <file> --agent <key>`. A hired agent whose role title
 * (the part before " — ") equals a pack's `name` runs with that pack.
 * See docs/extending.md → "Role packs".
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** A role pack's front matter: `name` must match the role title it applies to. */
export interface RolePack {
  /** File name, e.g. "code-reviewer.md" */
  file: string;
  name: string;
  description: string;
}

/** A role pack with its prompt body and the optional front matter Claude understands. */
export interface RolePackDefinition extends RolePack {
  /** The markdown after the front matter: the agent's system prompt */
  prompt: string;
  /** `tools:` front matter, comma-separated in the file */
  tools?: string[];
  /** `model:` front matter */
  model?: string;
}

/**
 * One entry of Claude Code's `--agents` JSON object (code.claude.com/docs/en/sub-agents,
 * "CLI-defined subagents"): the object's keys are agent names, each value a definition.
 */
export interface ClaudeAgentDefinition {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

/** Prefix for every key we pass to `--agents`, so we never shadow a user's own agent name. */
export const ROLE_PACK_KEY_PREFIX = "pixel-crew-";

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function readFrontMatter(content: string): { fields: Record<string, string>; body: string } | null {
  const m = FRONT_MATTER.exec(content);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { fields, body: content.slice(m[0].length) };
}

/**
 * Parse a role pack's YAML front matter (`---` / `name:` / `description:` / `---`).
 * Only these two single-line keys are read; null when either is missing.
 */
export function parseRolePack(file: string, content: string): RolePack | null {
  const fm = readFrontMatter(content);
  if (!fm?.fields.name || !fm.fields.description) return null;
  return { file, name: fm.fields.name, description: fm.fields.description };
}

/** parseRolePack plus the prompt body and optional `tools:` / `model:` front matter. */
export function parseRolePackDefinition(file: string, content: string): RolePackDefinition | null {
  const pack = parseRolePack(file, content);
  const fm = readFrontMatter(content);
  if (!pack || !fm) return null;
  const def: RolePackDefinition = { ...pack, prompt: fm.body.trim() };
  const tools = fm.fields.tools?.split(",").map(t => t.trim()).filter(Boolean);
  if (tools?.length) def.tools = tools;
  if (fm.fields.model) def.model = fm.fields.model;
  return def;
}

/** Bundled role packs that parse; invalid files are reported in `invalid`. */
export function listRolePacks(dir = getBundledAgentsDir()): { packs: RolePackDefinition[]; invalid: string[] } {
  const packs: RolePackDefinition[] = [];
  const invalid: string[] = [];
  if (!existsSync(dir)) return { packs, invalid };
  for (const file of readdirSync(dir).filter(f => f.endsWith(".md")).sort()) {
    const pack = parseRolePackDefinition(file, readFileSync(resolve(dir, file), "utf-8"));
    if (pack) packs.push(pack);
    else invalid.push(file);
  }
  return { packs, invalid };
}

/**
 * Directory containing our bundled agent .md files: dist/agents/ when this module is
 * bundled into the gateway (copied there by copy-role-packs.mjs), else the agents/
 * folder next to src/.
 */
export function getBundledAgentsDir(): string {
  const bundled = resolve(__dirname, "agents");
  if (existsSync(bundled)) return bundled;
  return resolve(__dirname, "../agents");
}

/** The `--agents` key for a pack: "code-reviewer.md" → "pixel-crew-code-reviewer". */
export function rolePackKey(pack: Pick<RolePack, "file">): string {
  return ROLE_PACK_KEY_PREFIX + basename(pack.file, ".md");
}

/** The `--agents` JSON object for these packs, keyed by rolePackKey. */
export function buildClaudeAgentsConfig(packs: readonly RolePackDefinition[]): Record<string, ClaudeAgentDefinition> {
  const out: Record<string, ClaudeAgentDefinition> = {};
  for (const p of packs) {
    const def: ClaudeAgentDefinition = { description: p.description, prompt: p.prompt };
    if (p.tools) def.tools = [...p.tools];
    if (p.model) def.model = p.model;
    out[rolePackKey(p)] = def;
  }
  return out;
}

let packIndex: Map<string, string> | null = null;

/**
 * The `--agents` key for a role title ("Code Reviewer" → "pixel-crew-code-reviewer"),
 * or undefined when no bundled pack has that name (compared case-insensitively).
 */
export function resolveRolePackKey(roleTitle: string, packs?: readonly RolePack[]): string | undefined {
  let index = packs ? null : packIndex;
  if (!index) {
    index = new Map((packs ?? listRolePacks().packs).map(p => [p.name.toLowerCase(), rolePackKey(p)]));
    if (!packs) packIndex = index;
  }
  return index.get(roleTitle.trim().toLowerCase());
}

/**
 * Write the bundled packs as Claude's `--agents` JSON to `file` (atomically: temp file
 * then rename) and return the path. The file belongs to Pixel Crew, e.g.
 * ~/.pixel-crew/data/claude-agents.json; nothing is written under ~/.claude/.
 */
export function writeClaudeAgentsFile(file: string, dir = getBundledAgentsDir()): { file: string; count: number; invalid: string[] } {
  const { packs, invalid } = listRolePacks(dir);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(buildClaudeAgentsConfig(packs), null, 2) + "\n", "utf-8");
  renameSync(tmp, file);
  return { file, count: packs.length, invalid };
}
