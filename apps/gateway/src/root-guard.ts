/**
 * Refuse to run as root unless --allow-root is given.
 *
 * Imported first by index.ts so it runs before config.ts creates any files.
 * Upstream rewrote ~/.claude/settings.json to bypassPermissions when running as
 * root; that is gone. Agents launched by root can damage the whole machine.
 */
export function checkRootAllowed(uid: number | undefined, argv: string[]): { ok: true } | { ok: false; message: string } {
  if (uid !== 0) return { ok: true };
  if (argv.includes("--allow-root")) return { ok: true };
  return {
    ok: false,
    message:
      "Pixel Crew refuses to run as root: agents would run with root privileges.\n" +
      "Run it as a normal user, or pass --allow-root if you really mean it.",
  };
}

const verdict = checkRootAllowed(process.getuid?.(), process.argv);
if (!verdict.ok) {
  console.error(verdict.message);
  process.exit(1);
} else if (process.getuid?.() === 0) {
  console.warn("[Gateway] Running as root (--allow-root). Claude bypass mode is unavailable as root; auto mode is used instead.");
}
