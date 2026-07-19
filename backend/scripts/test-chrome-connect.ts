// Manual smoke test for the browser automation foundation.
// Run with: npm run test:chrome-connect
//
// IMPORTANT: fully quit your real Chrome first (Cmd+Q) — Chrome only
// accepts --remote-debugging-port on a fresh launch, so if Chrome is
// already running against your normal profile this will fail to attach
// with debugging enabled.
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
