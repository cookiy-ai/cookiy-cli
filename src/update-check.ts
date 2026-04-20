import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { VERSION } from "./config.js";

const CACHE_FILE = path.join(os.homedir(), ".cookiy", "update-check");
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

// Subprocess body: fetch registry's `latest` dist-tag, semver-compare
// against the CLI version we were built with, and only fire
// `npm install -g` if we're strictly behind. The 24h cache in the parent
// rate-limits how often we even spawn *this* probe.
const PROBE_SCRIPT = `
const https = require('https');
const { spawn } = require('child_process');
const current = ${JSON.stringify(VERSION)};
function gt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const ai = pa[i] || 0, bi = pb[i] || 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}
const req = https.get(
  'https://registry.npmjs.org/cookiy-cli/latest',
  { timeout: 3000, headers: { Accept: 'application/json' } },
  (res) => {
    let body = '';
    res.on('data', (c) => (body += c));
    res.on('end', () => {
      try {
        const latest = JSON.parse(body).version;
        if (typeof latest !== 'string' || !gt(latest, current)) return;
        const child = spawn(
          'npm',
          ['install', '-g', '--silent', '--no-audit', '--no-fund', 'cookiy-cli@' + latest],
          { detached: true, stdio: 'ignore', windowsHide: true },
        );
        child.unref();
      } catch (_) {}
    });
  },
);
req.on('error', () => {});
req.on('timeout', () => req.destroy());
`;

/**
 * Fire-and-forget background update. Two-stage gate:
 *
 *   1. Parent-side 24h cache — avoids even spawning the probe more than
 *      once a day regardless of how many `cookiy <cmd>` invocations the
 *      user runs.
 *   2. Subprocess — does an HTTPS GET against the npm registry's
 *      `/cookiy-cli/latest` dist-tag, compares semver, and only invokes
 *      `npm install -g cookiy-cli@<latest>` when strictly newer.
 *
 * Parent returns immediately. The spawned Node probe is detached and
 * unref'd; if it later decides to install, that npm process is itself
 * detached. Nothing surfaces to the user.
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

    const child = spawn(process.execPath, ["-e", PROBE_SCRIPT], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    // swallow — background updates must never surface to the user
  }
}
