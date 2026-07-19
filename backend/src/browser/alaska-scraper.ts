import type { Page } from 'playwright';
import type { FlightCard, FlightLeg, SearchParams } from '../types.js';

// Deterministic Playwright automation for alaskaair.com — no LLM calls at
// runtime. Everything here is derived from the accessible role/name
// structure verified live against the real site (see
// ~/projects/milehop/main/docs/alaska-flow.md): Alaska's SPA doesn't expose
// stable CSS classes, but fare buttons have a stable, parseable accessible
// name (e.g. "Main 45k points + $32 Round trip"), which is what
// `page.getByRole('button', { name })` and the in-page regex parsing below
// both key off. This has NOT yet been run against the live site end-to-end
// (this dev sandbox has no real Chrome/display) — the parsing heuristics
// should be sanity-checked against one real run before being trusted fully.

const FARE_BUTTON_NAME = /round trip/i;
const COOKIE_DISMISS_NAME = 'Dismiss';
const ADD_TO_CART_NAME = 'Add to cart';

interface ParsedFare {
  tier: string; // Saver | Main | Premium | First
  points: number; // 0 in cash mode
  pointsCash: number; // co-pay in points mode, full price in cash mode
  cashOnly: number; // all-cash total, present in both modes when parseable
}

interface ParsedCard {
  /** Index into the page-wide, in-DOM-order list of fare buttons matching
   * FARE_BUTTON_NAME — used to re-locate this card's first (cheapest) fare
   * button for clicking, without needing a stable CSS selector. */
  fareButtonStartIndex: number;
  fareCount: number;
  fares: ParsedFare[];
  flightNumber: string;
  durationMinutes: number;
  stops: number;
  departTime: string; // "7:00 am"
  arriveTime: string; // "3:49 pm"
}

export function buildSearchUrl(params: SearchParams): string {
  const qp = new URLSearchParams({
    O: params.from.toUpperCase(),
    D: params.to.toUpperCase(),
    OD: params.departDate,
    DD: params.returnDate,
    A: String(params.passengers),
    RT: 'true',
    ShoppingMethod: params.usePoints ? 'onlineaward' : 'revenue',
    locale: 'en-us',
  });
  return `https://www.alaskaair.com/search/results?${qp.toString()}`;
}

export async function dismissCookieBanner(page: Page): Promise<void> {
  const dismiss = page.getByRole('button', { name: COOKIE_DISMISS_NAME });
  const visible = await dismiss.isVisible({ timeout: 3000 }).catch(() => false);
  if (visible) await dismiss.click().catch(() => {});
}

export async function waitForFareResults(page: Page): Promise<void> {
  await page.getByRole('button', { name: FARE_BUTTON_NAME }).first().waitFor({ timeout: 20_000 });
}

/**
 * Extracts every result "card" on the current results page (works for both
 * the outbound and the return step — Alaska reuses the same layout for
 * both). Runs entirely in-page via a single evaluate call: for each fare
 * button, walks up its ancestor chain until it finds one whose text content
 * contains at least two "h:mm am/pm" times (that's the card boundary), then
 * regex-parses the card's full text for flight number / duration / stops /
 * times, and regex-parses each fare button's own text for tier/points/cash.
 *
 * Deliberately avoids CSS class selectors — Alaska's build doesn't expose
 * stable ones. Airport-code-based stop counting (below) works around not
 * having a reliable "which text node is which" mapping: any 3-letter
 * uppercase code in the card's text that ISN'T the search's origin/
 * destination is a connection airport, i.e. one stop.
 */
export async function extractCards(
  page: Page,
  originCode: string,
  destCode: string,
): Promise<ParsedCard[]> {
  return page.evaluate(
    ({ originCode, destCode }) => {
      const FARE_RE = /round trip/i;
      const TIME_RE = /\b(\d{1,2}:\d{2}\s?[ap]m)\b/gi;
      const DURATION_RE = /(\d+)h\s*(\d+)m/;
      const FLIGHT_NUM_RE = /\bAS\s?\d{2,5}\b/i;
      const AIRPORT_RE = /\b([A-Z]{3})\b/g;
      const POINTS_FARE_RE = /^(Saver|Main|Premium|First)\s+([\d.]+)k\s+points\s*\+\s*\$(\d+(?:\.\d+)?)/i;
      const CASH_FARE_RE = /^(Saver|Main|Premium|First)\s+\$([\d,]+(?:\.\d+)?)/i;

      const allFareButtons = Array.from(document.querySelectorAll('button')).filter((b) =>
        FARE_RE.test(b.textContent || ''),
      );

      // Group buttons that share an immediate parent (Alaska renders each
      // card's fare tier buttons as siblings under one wrapper).
      const orderedParents: Element[] = [];
      const groupsByParent = new Map<Element, HTMLButtonElement[]>();
      for (const btn of allFareButtons) {
        const parent = btn.parentElement;
        if (!parent) continue;
        if (!groupsByParent.has(parent)) {
          groupsByParent.set(parent, []);
          orderedParents.push(parent);
        }
        groupsByParent.get(parent)!.push(btn as HTMLButtonElement);
      }

      const cards: unknown[] = [];
      let runningFareIndex = 0;

      for (const parent of orderedParents) {
        const buttons = groupsByParent.get(parent)!;
        const startIndex = runningFareIndex;
        runningFareIndex += buttons.length;

        // Walk up to find the card boundary: nearest ancestor whose text
        // contains at least 2 times.
        let node: Element | null = parent;
        let cardEl: Element | null = null;
        for (let i = 0; i < 8 && node; i++) {
          node = node.parentElement;
          if (!node) break;
          const times = (node.textContent || '').match(TIME_RE) || [];
          if (times.length >= 2) {
            cardEl = node;
            break;
          }
        }
        if (!cardEl) continue;

        const cardText = cardEl.textContent || '';
        const times = [...cardText.matchAll(TIME_RE)].map((m) => m[1]);
        if (times.length < 2) continue;

        const durationMatch = cardText.match(DURATION_RE);
        const durationMinutes = durationMatch
          ? Number(durationMatch[1]) * 60 + Number(durationMatch[2])
          : 0;

        const flightNumMatch = cardText.match(FLIGHT_NUM_RE);
        const flightNumber = flightNumMatch ? flightNumMatch[0].toUpperCase() : 'Unknown';

        const codes = [...cardText.matchAll(AIRPORT_RE)].map((m) => m[1]);
        const stops = codes.filter((c) => c !== originCode && c !== destCode).length;

        const fares: unknown[] = [];
        for (const btn of buttons) {
          const btnText = (btn.textContent || '').trim();
          const pointsMatch = btnText.match(POINTS_FARE_RE);
          const cashMatch = btnText.match(CASH_FARE_RE);
          if (pointsMatch) {
            fares.push({
              tier: pointsMatch[1],
              points: Math.round(Number(pointsMatch[2]) * 1000),
              pointsCash: Number(pointsMatch[3]),
              cashOnly: 0,
            });
          } else if (cashMatch) {
            fares.push({
              tier: cashMatch[1],
              points: 0,
              pointsCash: 0,
              cashOnly: Number(cashMatch[2].replace(/,/g, '')),
            });
          }
        }
        if (fares.length === 0) continue;

        cards.push({
          fareButtonStartIndex: startIndex,
          fareCount: buttons.length,
          fares,
          flightNumber,
          durationMinutes,
          stops,
          departTime: times[0],
          arriveTime: times[times.length - 1],
        });
      }

      return cards;
    },
    { originCode, destCode },
  ) as Promise<ParsedCard[]>;
}

/** Clicks the Nth fare button in page-wide fare-button order (as produced
 * by extractCards' fareButtonStartIndex) — this is what advances the SPA
 * from outbound results -> return results -> trip summary. */
export async function clickFareButtonAt(page: Page, globalIndex: number): Promise<void> {
  await page.getByRole('button', { name: FARE_BUTTON_NAME }).nth(globalIndex).click();
}

export async function clickAddToCart(page: Page): Promise<void> {
  await page.getByRole('button', { name: ADD_TO_CART_NAME }).click();
}

/** Combines a search-day date + "7:00 am"-style time into an ISO string. */
export function toIso(dateStr: string, timeStr: string): string {
  const m = timeStr.match(/(\d{1,2}):(\d{2})\s?([ap])m/i);
  if (!m) return new Date(`${dateStr}T00:00:00`).toISOString();
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'p') hour += 12;
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(hour, Number(m[2]), 0, 0);
  return d.toISOString();
}

export function parsedCardToLeg(
  card: ParsedCard,
  params: SearchParams,
  fromCode: string,
  toCode: string,
  dateStr: string,
): FlightLeg {
  return {
    airline: 'Alaska Airlines',
    flightNumber: card.flightNumber,
    fromCode,
    toCode,
    departTime: toIso(dateStr, card.departTime),
    arriveTime: toIso(dateStr, card.arriveTime),
    durationMinutes: card.durationMinutes,
    stops: card.stops,
  };
}

/** Cheapest fare on a card is always listed first (Saver < Main < Premium <
 * First, or Main < First in points mode) — matches the discovered ordering. */
export function cheapestFare(card: ParsedCard): ParsedFare {
  return card.fares[0];
}

export function fareToPricing(fare: ParsedFare, params: SearchParams): Pick<FlightCard, 'cashPrice' | 'points' | 'pointsCash'> {
  if (params.usePoints) {
    return { cashPrice: 0, points: fare.points, pointsCash: fare.pointsCash };
  }
  return { cashPrice: fare.cashOnly, points: 0, pointsCash: 0 };
}

export type { ParsedCard, ParsedFare };
