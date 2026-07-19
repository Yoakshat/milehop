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
// One tab per outbound option (up to 5), opened in parallel and staggered
// ~250ms apart (per docs/alaska-flow.md's open item about possible
// rate-limiting on simultaneous requests). Each tab: loads the shared
// results URL, claims "its" outbound row by index, commits to that row's
// cheapest fare (which morphs the SAME tab into return-flight results —
// Alaska's site doesn't navigate to a new URL for this), then reads off
// (WITHOUT clicking — see previewCheapestFareInRow) the top 3 return
// rows' prices. Alaska recomputes each return row's fare to already be
// the FULL round-trip total once an outbound leg is locked in (verified
// live: after picking a 45k-point outbound, the return page's rows read
// e.g. "60k points + $12" and the trip-summary page's "Total" matches
// that number exactly) — so no outbound+return math is needed, the
// return-row fare IS the card's total price.
//
// Tabs are kept open (not closed, nothing else clicked) after streaming
// their 3 cards, so a later /book call can resume the exact right tab and
// commit to the specific return row the user picked.

interface BookableEntry {
  tabId: TabId;
  returnRowIndex: number;
}

const bookableCards = new Map<string, BookableEntry>();

async function searchOneOutboundOption(
  outboundIndex: number,
  params: SearchParams,
  onCard: (card: FlightCard) => void,
): Promise<void> {
  try {
    const { openTab } = await connectToRealChrome();
    const url = buildSearchUrl(params);
    const { tabId, page } = await openTab(url);

    await dismissCookieBanner(page);
    await waitForFareResults(page);

    const outboundRows = getCardRows(page);
    const outboundRow = outboundRows.nth(outboundIndex);
    if ((await outboundRows.count()) <= outboundIndex) return; // fewer than 5 outbound results

    const outboundInfo = await extractCardInfo(outboundRow, params.from.toUpperCase(), params.to.toUpperCase());
    if (!outboundInfo) return;

    await selectCheapestFareInRow(outboundRow); // commits this tab to this outbound leg

    await waitForFareResults(page);
    const returnRows = getCardRows(page);
    const returnCount = Math.min(3, await returnRows.count());

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

/** Runs all 5 outbound explorations in parallel (staggered start), calling
 * `onCard` as each of up to 15 (5 outbound x top-3 return) cards is found.
 * Resolves once every tab has finished (or failed). */
export async function runAlaskaSearch(params: SearchParams, onCard: (card: FlightCard) => void): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (let i = 0; i < 5; i++) {
    tasks.push(searchOneOutboundOption(i, params, onCard));
    await new Promise((r) => setTimeout(r, 250)); // stagger tab creation
  }
  await Promise.allSettled(tasks);
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
