import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const CACHE_FILE = path.join(os.homedir(), ".cookiy", "update-check");
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Fire-and-forget background update. Rate-limited to once per 24h via the
 * cache file. Spawns a detached `npm install -g cookiy-cli@latest`, then
 * returns immediately; the child outlives the current CLI invocation.
 *
 * If npm is missing, the user is offline, or global install would need
 * sudo — all failures are silent. The running Node process has already
 * loaded the bundled entrypoint into memory, so an in-flight swap of the
 * bin symlink cannot corrupt the current command.
 */
export function scheduleBackgroundUpdate(): void {
  try {
    const now = Date.now();
    if (fs.existsSync(CACHE_FILE)) {
      const last = parseInt(fs.readFileSync(CACHE_FILE, "utf8"), 10) || 0;
      if (now - last < INTERVAL_MS) return;
    }
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, String(now));

    const child = spawn(
      "npm",
      ["install", "-g", "--silent", "--no-audit", "--no-fund", "cookiy-cli@latest"],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    child.unref();
  } catch {
    // swallow — background updates must never surface to the user
  }
}
