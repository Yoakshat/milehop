import { connectToRealChrome } from '../src/browser/context-manager.js';
import {
  buildSearchUrl,
  dismissCookieBanner,
  waitForFareResults,
  getCardRows,
  extractCardInfo,
  selectCheapestFareInRow,
  previewCheapestFareInRow,
} from '../src/browser/alaska-scraper.js';

async function main() {
  const { openTab } = await connectToRealChrome();
  const url = buildSearchUrl({
    from: 'SFO',
    to: 'JFK',
    departDate: '2026-08-14',
    returnDate: '2026-08-21',
    passengers: 1,
    usePoints: true,
  });
  const { tabId, page } = await openTab(url);
  console.log('Tab opened:', tabId);
  await dismissCookieBanner(page);
  await waitForFareResults(page);

  const rows = getCardRows(page);
  const count = await rows.count();
  console.log('Row count:', count);

  for (let i = 0; i < Math.min(count, 3); i++) {
    const row = rows.nth(i);
    const info = await extractCardInfo(row, 'SFO', 'JFK');
    const preview = await previewCheapestFareInRow(row);
    console.log(`Row ${i}:`, JSON.stringify({ info, preview }));
  }

  console.log('--- committing to outbound row 0 ---');
  const outboundRow = rows.nth(0);
  const outboundInfo = await extractCardInfo(outboundRow, 'SFO', 'JFK');
  const outboundFare = await selectCheapestFareInRow(outboundRow);
  console.log('Outbound committed:', JSON.stringify({ outboundInfo, outboundFare }));

  await waitForFareResults(page);
  const returnRows = getCardRows(page);
  const returnCount = await returnRows.count();
  console.log('Return row count:', returnCount);
  for (let i = 0; i < Math.min(returnCount, 3); i++) {
    const row = returnRows.nth(i);
    const info = await extractCardInfo(row, 'JFK', 'SFO');
    const preview = await previewCheapestFareInRow(row);
    console.log(`Return row ${i}:`, JSON.stringify({ info, preview }));
  }

  process.exit(0);
}
main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
