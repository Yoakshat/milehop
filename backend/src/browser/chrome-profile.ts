import { existsSync, mkdirSync, cpSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Ported verbatim (structure-wise) from
// ~/projects/voyage/main/src/main/browser/chrome-profile.ts. This is the
// piece that makes "real Chrome + real cookies" actually work: Chrome
// 136+ blocks --remote-debugging-port from attaching to the DEFAULT
// profile directory (to stop exactly this class of cookie exfiltration),
// so CDP has to point at a SEPARATE directory — but that directory can be
// a one-time copy of the user's real profile, which is what this does.
// (An earlier version of this file wrongly assumed live default-profile
// CDP was possible and had no copy step at all — this replaces that.)

const EXCLUDE_DIRS = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnWebGPUCache',
  'Service Worker',
  'IndexedDB',
  'Application Cache',
  'blob_storage',
  'Media Cache',
  'GrShaderCache',
  'ShaderCache',
  'Crashpad',
  'History',
  'History-journal',
  'Extensions',
  'Local Extension Settings',
  'Shared Dictionary',
  'Favicons',
  'Favicons-journal',
]);

function realChromeUserDataDir(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
}

function milehopProfileDir(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'milehop', 'chrome-profile');
}

/** Copies the real Chrome profile into milehop's own userData dir, excluding
 * heavy/unneeded directories (History alone was 7GB+ in voyage's testing).
 * Skips the copy if it already exists — call refreshChromeProfile()
 * explicitly to re-copy (e.g. if the Alaska session cookie has expired). */
export function ensureChromeProfile(): string {
  const dest = milehopProfileDir();
  if (existsSync(path.join(dest, 'Default'))) {
    return dest;
  }
  return refreshChromeProfile();
}

export function refreshChromeProfile(): string {
  const src = realChromeUserDataDir();
  const dest = milehopProfileDir();

  if (!existsSync(src)) {
    throw new Error(`Real Chrome profile not found at ${src}. Is Chrome installed?`);
  }

  mkdirSync(dest, { recursive: true });

  const localStatePath = path.join(src, 'Local State');
  if (existsSync(localStatePath)) {
    cpSync(localStatePath, path.join(dest, 'Local State'));
  }

  cpSync(path.join(src, 'Default'), path.join(dest, 'Default'), {
    recursive: true,
    filter: (srcPath) => !EXCLUDE_DIRS.has(path.basename(srcPath)),
  });

  return dest;
}
