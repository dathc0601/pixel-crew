/**
 * Import this FIRST in gateway tests. It points the data dir at a temp folder
 * before config.ts runs, so tests never touch ~/.pixel-crew.
 */
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

export const TEST_HOME = mkdtempSync(join(tmpdir(), "pixel-crew-test-"));
process.env.PIXEL_CREW_HOME = TEST_HOME;
process.env.NO_OPEN = "1";
delete process.env.ABLY_API_KEY;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.PIXEL_CREW_LAN;
if (process.env.NODE_ENV === "development") delete process.env.NODE_ENV;
