// Manual smoke test for the browser automation foundation.
// Run with: npm run test:chrome-connect
//
// FIRST RUN ONLY: fully quit your real Chrome first (Cmd+Q). This
// connects to a dedicated Chrome instance backed by a one-time COPY of
// your real profile (see chrome-profile.ts) — copying a live SQLite
// Cookies file while Chrome has it open risks grabbing an inconsistent
// snapshot, so the safe window is while Chrome is closed. After that
// first copy, your normal Chrome can be open or closed for future runs —
// this connects to its own separate profile/process, not your real one.
import { connectToRealChrome } from '../src/browser/context-manager.js';

async function main() {
  console.log('Connecting to real Chrome...');
  const { openTab, listTabs } = await connectToRealChrome();

  console.log('Opening new tab -> google.com');
  const { tabId, page } = await openTab('https://www.google.com');
  await page.waitForLoadState('domcontentloaded');

  console.log(`Opened tab ${tabId}, title: "${await page.title()}"`);
  console.log('All tabs:', listTabs());

  console.log('Success.');
  process.exit(0);
}

main().catch((err) => {
  console.error('test-chrome-connect failed:', err);
  process.exit(1);
});
