import type { Page } from 'playwright';
import type { FlightCard, SearchParams } from '../types.js';
import { connectToRealChrome, type TabId } from './context-manager.js';
import {
  buildSearchUrl,
  cardInfoToLeg,
  clickAddToCart,
  dismissCookieBanner,
  extractCardInfo,
  fareToPricing,
  getCardRows,
  previewCheapestFareInRow,
  selectCheapestFareInRow,
  waitForFareResults,
} from './alaska-scraper.js';

// Orchestrates the real-Alaska-site version of /search/stream and /book.
//
// One tab per outbound option (up to 5). The INITIAL page load (goto +
// cookie-dismiss + wait for fares) is the expensive part — real
// contention was observed live when 5 tabs hit it near-simultaneously (2
// of 5 failed with a page.goto timeout in one run) — so that step is run
// SEQUENTIALLY, one tab fully loaded before the next tab's load even
// starts. Once a tab has loaded, the rest of its work (commit to its
// outbound row, wait for the return page, read off every return row) is
// comparatively cheap (an in-place SPA update, not a fresh navigation) and
// runs concurrently across tabs — it doesn't need to wait for other tabs'
// loads to finish.
//
// Every return row is streamed now (not capped at top 3) — reading a row
// is just text/regex parsing, no extra clicks or waits, so it costs
// nothing beyond the one page load already paid for.
//
// Alaska recomputes each return row's fare to already be the FULL
// round-trip total once an outbound leg is locked in (verified live:
// after picking a 45k-point outbound, the return page's rows read e.g.
// "60k points + $12" and the trip-summary page's "Total" matches that
// number exactly) — so no outbound+return math is needed, the return-row
// fare IS the card's total price.
//
// Tabs are kept open (not closed, nothing else clicked) after streaming
// their cards, so a later /book call can resume the exact right tab and
// commit to the specific return row the user picked.

interface BookableEntry {
  tabId: TabId;
  returnRowIndex: number;
}

const bookableCards = new Map<string, BookableEntry>();

/** The expensive, sequential part: open a tab and get it to a loaded
 * results page. Returns null (rather than throwing) on failure so the
 * caller can just skip that outbound slot and keep going. */
async function openAndLoadOutboundTab(
  params: SearchParams,
): Promise<{ tabId: TabId; page: Page } | null> {
  try {
    const { openTab } = await connectToRealChrome();
    const url = buildSearchUrl(params);
    const { tabId, page } = await openTab(url);
    await dismissCookieBanner(page);
    await waitForFareResults(page);
    return { tabId, page };
  } catch (err) {
    console.error('[alaska-session] tab load failed:', err);
    return null;
  }
}

/** The cheap, concurrent part: claim this tab's outbound row, commit to
 * its cheapest fare, then stream every return row's preview. */
async function processOutboundTab(
  outboundIndex: number,
  tabId: TabId,
  page: Page,
  params: SearchParams,
  onCard: (card: FlightCard) => void,
): Promise<void> {
  try {
    const outboundRows = getCardRows(page);
    if ((await outboundRows.count()) <= outboundIndex) return; // fewer than 5 outbound results
    const outboundRow = outboundRows.nth(outboundIndex);

    const outboundInfo = await extractCardInfo(outboundRow, params.from.toUpperCase(), params.to.toUpperCase());
    if (!outboundInfo) return;

    await selectCheapestFareInRow(outboundRow); // commits this tab to this outbound leg

    await waitForFareResults(page);
    const returnRows = getCardRows(page);
    const returnCount = await returnRows.count();

    const outboundLeg = cardInfoToLeg(outboundInfo, params.from.toUpperCase(), params.to.toUpperCase(), params.departDate);

    for (let i = 0; i < returnCount; i++) {
      const returnRow = returnRows.nth(i);
      const returnInfo = await extractCardInfo(returnRow, params.to.toUpperCase(), params.from.toUpperCase());
      const returnFare = await previewCheapestFareInRow(returnRow);
      if (!returnInfo || !returnFare) continue;

      const returnLeg = cardInfoToLeg(returnInfo, params.to.toUpperCase(), params.from.toUpperCase(), params.returnDate);
      const cardId = `alaska-${tabId}-${i}`;
      bookableCards.set(cardId, { tabId, returnRowIndex: i });

      onCard({
        id: cardId,
        outbound: outboundLeg,
        return: returnLeg,
        ...fareToPricing(returnFare, params),
      });
    }
  } catch (err) {
    console.error(`[alaska-session] outbound option ${outboundIndex} failed:`, err);
  }
}

/** Loads up to 5 outbound tabs one at a time, kicking off each tab's
 * (cheaper, concurrent) processing as soon as it's loaded rather than
 * waiting for it to finish before starting the next tab's load. Resolves
 * once every tab's processing has settled. */
export async function runAlaskaSearch(params: SearchParams, onCard: (card: FlightCard) => void): Promise<void> {
  const pending: Promise<void>[] = [];
  for (let i = 0; i < 5; i++) {
    const loaded = await openAndLoadOutboundTab(params);
    if (!loaded) continue;
    pending.push(processOutboundTab(i, loaded.tabId, loaded.page, params, onCard));
  }
  await Promise.allSettled(pending);
}

/** Resumes the tab for a previously streamed card (still sitting on the
 * return-results page, nothing committed yet — see module comment),
 * commits to its specific return row's cheapest fare (advancing the SPA
 * to the Trip Summary page), and clicks Add to Cart. Login (if Alaska
 * prompts for it here) is left for the user to handle manually — out of
 * scope for this demo. */
export async function bookAlaskaCard(cardId: string): Promise<{ ok: boolean; reason?: string }> {
  const entry = bookableCards.get(cardId);
  if (!entry) return { ok: false, reason: 'Unknown or expired cardId' };

  const { getTab } = await connectToRealChrome();
  const page = getTab(entry.tabId);
  if (!page) return { ok: false, reason: 'Tab no longer open' };

  try {
    const row = getCardRows(page).nth(entry.returnRowIndex);
    await selectCheapestFareInRow(row);
    await clickAddToCart(page);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}
