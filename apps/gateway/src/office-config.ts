import { EventEmitter } from "events";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, watch, writeFileSync, type FSWatcher } from "fs";
import { basename, dirname, join } from "path";
import { OfficeConfigSchema, DEFAULT_OFFICE_CONFIG, type OfficeConfig } from "@pixel-crew/shared";

export type OfficeConfigParse = { ok: true; config: OfficeConfig } | { ok: false; error: string };

/** Validate the "office" section of a parsed config.json (missing section → defaults). */
export function parseOfficeSection(rawConfig: unknown): OfficeConfigParse {
  const section = rawConfig && typeof rawConfig === "object" ? (rawConfig as Record<string, unknown>).office : undefined;
  const result = OfficeConfigSchema.safeParse(section ?? {});
  if (result.success) return { ok: true, config: result.data };
  const error = result.error.issues
    .map((i) => `office.${i.path.join(".")}: ${i.message}`)
    .join("; ");
  return { ok: false, error };
}

export type OfficeConfigUpdate =
  | { ok: true; config: OfficeConfig; changed: boolean }
  | { ok: false; error: string };

type Json = Record<string, unknown>;
const isPlainObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep-merge `patch` into `base` (new object). `null` deletes a key; arrays and scalars replace. */
export function mergeOfficePatch(base: Json, patch: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else if (isPlainObject(value) && isPlainObject(out[key])) out[key] = mergeOfficePatch(out[key] as Json, value);
    else if (isPlainObject(value)) out[key] = mergeOfficePatch({}, value);
    else out[key] = value;
  }
  return out;
}

interface OfficeConfigEvents {
  change: [OfficeConfig];
  invalid: [string];
}

/**
 * Loads, validates and hot-reloads the office section of config.json.
 * On an invalid edit the last valid config stays in effect (defaults on first load).
 */
export class OfficeConfigManager extends EventEmitter<OfficeConfigEvents> {
  private current: OfficeConfig = DEFAULT_OFFICE_CONFIG;
  private lastError: string | null = null;
  private watcher: FSWatcher | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly file: string, private debounceMs = 150) {
    super();
  }

  get(): OfficeConfig {
    return this.current;
  }

  get error(): string | null {
    return this.lastError;
  }

  /** (Re)read the file. Returns true when the effective config changed. */
  reload(): boolean {
    let raw: unknown = {};
    if (existsSync(this.file)) {
      try {
        raw = JSON.parse(readFileSync(this.file, "utf-8"));
      } catch (err) {
        return this.reject(`config.json is not valid JSON: ${(err as Error).message}`);
      }
    }
    const parsed = parseOfficeSection(raw);
    if (!parsed.ok) return this.reject(parsed.error);
    this.lastError = null;
    const changed = JSON.stringify(parsed.config) !== JSON.stringify(this.current);
    this.current = parsed.config;
    if (changed) this.emit("change", this.current);
    return changed;
  }

  /**
   * Apply a deep-partial patch to the office section and write config.json atomically
   * (temp file + rename in the same directory). Other top-level keys are kept as they
   * are. Nothing is written when the merged section fails validation.
   */
  update(patch: Json): OfficeConfigUpdate {
    let raw: Json = {};
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf-8"));
        if (!isPlainObject(parsed)) return { ok: false, error: "config.json is not a JSON object; fix it by hand first" };
        raw = parsed;
      } catch (err) {
        return { ok: false, error: `config.json is not valid JSON (${(err as Error).message}); fix it by hand first` };
      }
    }
    const section = isPlainObject(raw.office) ? raw.office : {};
    const merged = mergeOfficePatch(section, patch);
    const parsed = parseOfficeSection({ office: merged });
    if (!parsed.ok) return { ok: false, error: parsed.error };

    const dir = dirname(this.file);
    const tmp = join(dir, `.${basename(this.file)}.${process.pid}.${Date.now()}.tmp`);
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(tmp, JSON.stringify({ ...raw, office: merged }, null, 2) + "\n", "utf-8");
      renameSync(tmp, this.file);
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* not created */ }
      return { ok: false, error: `Could not write config.json: ${(err as Error).message}` };
    }
    const changed = this.reload();
    return { ok: true, config: this.current, changed };
  }

  private reject(error: string): boolean {
    this.lastError = error;
    console.warn(`[Config] Ignoring invalid office config (keeping previous values): ${error}`);
    this.emit("invalid", error);
    return false;
  }

  /** Watch the config file's directory (editors often replace the file instead of writing in place). */
  watch(): void {
    if (this.watcher) return;
    const dir = dirname(this.file);
    const name = basename(this.file);
    if (!existsSync(dir)) return;
    try {
      this.watcher = watch(dir, (_event, filename) => {
        if (filename && filename.toString() !== name) return;
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
          this.debounce = null;
          if (this.reload()) console.log("[Config] Office config reloaded");
        }, this.debounceMs);
      });
      this.watcher.unref();
    } catch (err) {
      console.warn(`[Config] Hot reload unavailable: ${(err as Error).message}`);
    }
  }

  close(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    this.watcher?.close();
    this.watcher = null;
  }
}
