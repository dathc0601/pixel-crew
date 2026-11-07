/** Import FIRST: isolates the data dir before orchestrator modules compute their paths. */
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export const TEST_HOME = mkdtempSync(join(tmpdir(), "pixel-crew-orch-"));
process.env.PIXEL_CREW_HOME = TEST_HOME;
