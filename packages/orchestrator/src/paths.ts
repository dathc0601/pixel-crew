import path from "path";
import { homedir } from "os";

/**
 * Root data directory: ~/.pixel-crew (release) or ~/.pixel-crew-dev (NODE_ENV=development).
 * PIXEL_CREW_HOME overrides it (used by tests and portable installs).
 * The gateway migrates the legacy ~/.open-office[-dev] directory before anything else runs.
 */
export function getDataDir(): string {
  if (process.env.PIXEL_CREW_HOME) return path.resolve(process.env.PIXEL_CREW_HOME);
  return path.join(homedir(), process.env.NODE_ENV === "development" ? ".pixel-crew-dev" : ".pixel-crew");
}
