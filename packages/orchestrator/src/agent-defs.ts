/**
 * Role packs: sync bundled agent definitions to ~/.claude/agents/ on startup.
 * These are curated, compact agent profiles used by Claude Code's --agent flag: a hired
 * agent whose role title (the part before " — ") equals a pack's `name` runs with it.
 * See docs/extending.md → "Role packs".
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** A role pack's front matter: `name` must match the role title it applies to. */
export interface RolePack {
  /** File name, e.g. "code-reviewer.md" */
  file: string;
  name: string;
  description: string;
}

/**
 * Parse a role pack's YAML front matter (`---` / `name:` / `description:` / `---`).
 * Only these two single-line keys are read; null when either is missing.
 */
export function parseRolePack(file: string, content: string): RolePack | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  if (!fields.name || !fields.description) return null;
  return { file, name: fields.name, description: fields.description };
}

/** Bundled role packs that parse; invalid files are reported in `invalid`. */
export function listRolePacks(dir = getBundledAgentsDir()): { packs: RolePack[]; invalid: string[] } {
  const packs: RolePack[] = [];
  const invalid: string[] = [];
  if (!existsSync(dir)) return { packs, invalid };
  for (const file of readdirSync(dir).filter(f => f.endsWith(".md")).sort()) {
    const pack = parseRolePack(file, readFileSync(resolve(dir, file), "utf-8"));
    if (pack) packs.push(pack);
    else invalid.push(file);
  }
  return { packs, invalid };
}

/** Directory containing our bundled agent .md files (relative to dist/) */
export function getBundledAgentsDir(): string {
  // In dist/: ../agents/  (agents/ is sibling to src/)
  const fromDist = resolve(__dirname, "../agents");
  if (existsSync(fromDist)) return fromDist;
  // In src/ during dev: ../agents/
  const fromSrc = resolve(__dirname, "../agents");
  return fromSrc;
}

/** Sync bundled agent definitions to Claude Code's global agents directory */
export function syncAgentDefs(): void {
  const bundledDir = getBundledAgentsDir();
  if (!existsSync(bundledDir)) {
    console.log(`[Agents] No bundled agents directory found at ${bundledDir}`);
    return;
  }

  const targetDir = resolve(homedir(), ".claude", "agents");
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const { packs, invalid } = listRolePacks(bundledDir);
  for (const file of invalid) console.warn(`[Agents] Skipping ${file}: front matter needs name and description`);
  let synced = 0;
  for (const { file } of packs) {
    const src = resolve(bundledDir, file);
    const dst = resolve(targetDir, file);
    try {
      const content = readFileSync(src, "utf-8");
      writeFileSync(dst, content, "utf-8");
      synced++;
    } catch (e) {
      console.warn(`[Agents] Failed to sync ${file}: ${e}`);
    }
  }
  console.log(`[Agents] Synced ${synced} agent definitions to ${targetDir}`);
}
