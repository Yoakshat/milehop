import type { FlightCard, SearchParams } from '../types.js';
import { connectToRealChrome, type TabId } from './context-manager.js';
import {
  buildSearchUrl,
  cheapestFare,
  clickAddToCart,
  clickFareButtonAt,
  dismissCookieBanner,
  extractCards,
  fareToPricing,
  parsedCardToLeg,
  waitForFareResults,
  type ParsedCard,
} from './alaska-scraper.js';

// Orchestrates the real-Alaska-site version of /search/stream and /book.
//
// One tab per outbound option (up to 5), opened in parallel and staggered
// ~250ms apart (per docs/alaska-flow.md's open item about possible
// rate-limiting on simultaneous requests). Each tab: loads the shared
// results URL, claims "its" outbound card by index, clicks that card's
// cheapest fare (which morphs the SAME tab into return-flight results —
// Alaska's site doesn't navigate to a new URL for this), then reads off the
// top 3 return options. Alaska recomputes each return fare button's price
// to already be the FULL round-trip total once an outbound leg is locked
// in (verified live: after picking a 45k-point outbound, the return page's
// buttons read e.g. "Main 60k points + $12" and the trip-summary page's
// "Total" matches that number exactly) — so no outbound+return math is
// needed, the return-stage fare IS the card's total price.
//
// Tabs are kept open (not closed) after streaming their 3 cards, so a
// later /book call can resume the exact right tab.

interface BookableEntry {
  tabId: TabId;
  returnFareButtonIndex: number;
}

const bookableCards = new Map<string, BookableEntry>();

async function searchOneOutboundOption(
  outboundIndex: number,
  params: SearchParams,
  onCard: (card: FlightCard) => void,
): Promise<void> {
  const { openTab } = await connectToRealChrome();
  const url = buildSearchUrl(params);
  const { tabId, page } = await openTab(url);

  try {
    await dismissCookieBanner(page);
    await waitForFareResults(page);

    const outboundCards = await extractCards(page, params.from.toUpperCase(), params.to.toUpperCase());
    const outboundCard: ParsedCard | undefined = outboundCards[outboundIndex];
    if (!outboundCard) return; // fewer than 5 outbound results for this route/date

    const outboundFare = cheapestFare(outboundCard);
    await clickFareButtonAt(page, outboundCard.fareButtonStartIndex);

    await waitForFareResults(page);
    const returnCards = await extractCards(page, params.to.toUpperCase(), params.from.toUpperCase());

    const outboundLeg = parsedCardToLeg(
      outboundCard,
      params,
      params.from.toUpperCase(),
      params.to.toUpperCase(),
      params.departDate,
    );

    for (const returnCard of returnCards.slice(0, 3)) {
      const returnFare = cheapestFare(returnCard);
      const returnLeg = parsedCardToLeg(
        returnCard,
        params,
        params.to.toUpperCase(),
        params.from.toUpperCase(),
        params.returnDate,
      );
      const cardId = `alaska-${tabId}-${returnCard.fareButtonStartIndex}`;
      bookableCards.set(cardId, { tabId, returnFareButtonIndex: returnCard.fareButtonStartIndex });

      onCard({
        id: cardId,
        outbound: outboundLeg,
        return: returnLeg,
        ...fareToPricing(returnFare, params),
      });
    }

    void outboundFare; // only used to pick which outbound option to explore; see module comment
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

/** Resumes the tab for a previously streamed card, selects its return fare
 * (advancing the SPA to the Trip Summary page), and clicks Add to Cart.
 * Login (if Alaska prompts for it here) is left for the user to handle
 * manually — out of scope for this demo. */
export async function bookAlaskaCard(cardId: string): Promise<{ ok: boolean; reason?: string }> {
  const entry = bookableCards.get(cardId);
  if (!entry) return { ok: false, reason: 'Unknown or expired cardId' };

  const { getTab } = await connectToRealChrome();
  const page = getTab(entry.tabId);
  if (!page) return { ok: false, reason: 'Tab no longer open' };

  try {
    await clickFareButtonAt(page, entry.returnFareButtonIndex);
    await clickAddToCart(page);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}
