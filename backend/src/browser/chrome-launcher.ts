import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Ported from ~/projects/voyage/main/src/main/browser/chrome-launcher.ts,
// adapted for a plain Node/Express server (no Electron main process) and —
// crucially — for connecting to the user's REAL Chrome profile rather than
// a copied/dedicated debug profile.
//
// IMPORTANT: Chrome only accepts --remote-debugging-port on a *fresh* launch
// (i.e. no Chrome process already running against this profile). If the
// user's normal Chrome is already open, this will fail to get a CDP-enabled
// instance — quit Chrome completely (Cmd+Q, not just closing windows) before
// calling launchChrome()/connectToRealChrome().

const CHROME_BINARY = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = 9333;

let chromeProcess: ChildProcess | null = null;

/** The user's actual Chrome profile directory — NOT a copy. Reusing this
 * directly (rather than voyage's copy-the-profile approach) is what lets
 * this app see the user's real cookies/logins with zero setup, at the cost
 * of requiring Chrome to be fully quit first (see module comment above). */
export function realChromeUserDataDir(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
}

async function isPortResponding(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortResponding(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Chrome CDP endpoint on port ${port} did not respond within ${timeoutMs}ms. ` +
      `Make sure any already-running Chrome was fully quit (Cmd+Q) before launching — ` +
      `Chrome silently ignores --remote-debugging-port if an instance is already running.`,
  );
}

interface LaunchChromeOptions {
  timeoutMs?: number;
}

/** Launches the user's real Chrome.app against their real profile with CDP
 * enabled. Idempotent: if something is already responding on the CDP port,
 * reuses it instead of spawning a second process (which Chrome would refuse
 * anyway against the same profile). */
export async function launchChrome(opts: LaunchChromeOptions = {}): Promise<{ cdpUrl: string; reused: boolean }> {
  const cdpUrl = `http://localhost:${CDP_PORT}`;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  if (await isPortResponding(CDP_PORT)) {
    return { cdpUrl, reused: true };
  }

  if (!existsSync(CHROME_BINARY)) {
    throw new Error(`Google Chrome not found at ${CHROME_BINARY}`);
  }

  const profileDir = realChromeUserDataDir();
  if (!existsSync(profileDir)) {
    throw new Error(`Chrome profile directory not found at ${profileDir}. Is Chrome installed and has it been run once?`);
  }

  chromeProcess = spawn(
    CHROME_BINARY,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      '--profile-directory=Default',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { stdio: 'ignore', detached: false },
  );

  await Promise.race([
    waitForPort(CDP_PORT, timeoutMs),
    new Promise<never>((_, reject) => {
      chromeProcess?.once('exit', (code, signal) => {
        reject(new Error(`Chrome exited before CDP became ready (code=${code ?? 'null'}, signal=${signal ?? 'null'})`));
      });
    }),
  ]);

  return { cdpUrl, reused: false };
}

export function quitChrome(): void {
  if (chromeProcess && !chromeProcess.killed) {
    chromeProcess.kill();
  }
  chromeProcess = null;
}
