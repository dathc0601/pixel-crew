import { EventEmitter } from "events";
import { existsSync, readFileSync, watch, type FSWatcher } from "fs";
import { basename, dirname } from "path";
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
