import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

// Ported from ~/projects/voyage/main/src/main/browser/chrome-launcher.ts,
// adapted for a plain Node/Express server (no Electron main process).
//
// Takes `profileDir` as a parameter (from chrome-profile.ts's
// ensureChromeProfile()) rather than owning it — matches voyage's split:
// this file only knows how to launch/reuse a CDP-enabled Chrome process
// against whatever profile directory it's handed; chrome-profile.ts owns
// what that directory actually contains (a one-time copy of the user's
// real Chrome profile, so cookies/logins carry over).
//
// This copy step is required, not optional: Chrome 136+ blocks
// --remote-debugging-port from attaching to the DEFAULT profile directory
// specifically to prevent malware from exfiltrating cookies/sessions via
// CDP. A separate (copied) profile directory sidesteps that restriction
// entirely, same as voyage does.

const CHROME_BINARY = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_PORT = 9333;

let chromeProcess: ChildProcess | null = null;

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
  throw new Error(`Chrome CDP endpoint on port ${port} did not respond within ${timeoutMs}ms.`);
}

interface LaunchChromeOptions {
  timeoutMs?: number;
}

/** Launches a real, visible Chrome.app against the given profile directory
 * (see chrome-profile.ts) with CDP enabled. Idempotent: if something is
 * already responding on the CDP port, reuses it instead of spawning a
 * second process. */
export async function launchChrome(
  profileDir: string,
  opts: LaunchChromeOptions = {},
): Promise<{ cdpUrl: string; reused: boolean }> {
  const cdpUrl = `http://localhost:${CDP_PORT}`;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  if (await isPortResponding(CDP_PORT)) {
    return { cdpUrl, reused: true };
  }

  if (!existsSync(CHROME_BINARY)) {
    throw new Error(`Google Chrome not found at ${CHROME_BINARY}`);
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
