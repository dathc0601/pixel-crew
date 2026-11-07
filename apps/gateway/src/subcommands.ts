// Subcommands that run instead of the gateway. Imported by index.ts right after
// root-guard: a subcommand runs synchronously and exits, before the gateway modules load.
import { runClaudeAttachable } from "./attach/claude-attachable.js";

if (process.argv[2] === "claude-attachable") {
  process.exit(runClaudeAttachable(process.argv.slice(3)));
}
