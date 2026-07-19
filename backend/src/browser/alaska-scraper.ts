import type { Locator, Page } from 'playwright';
import type { FlightCard, FlightLeg, SearchParams } from '../types.js';

// Deterministic Playwright automation for alaskaair.com — no LLM calls at
// runtime. Row-scoped: every result is one native <tr> (table row) — far
// more stable than tracking a global button index, which an earlier
// version of this file did and broke on a real run (see below).
//
// Row selection uses `tr.matrixRow`, not `getByRole('row')` — verified
// live that getByRole('row') matches ZERO elements here even though the
// <tr>s are real and populated: their CSS sets `display: grid` (confirmed
// via the class name itself, `matrixRow grid ...`), and per the HTML
// accessibility mapping spec, a <tr> only keeps its implicit ARIA `row`
// role when its CSS display stays table-row-shaped — overriding it to
// `grid` strips that mapping, so the "obviously more robust, role-based"
// approach doesn't apply here. `matrixRow` reads as an intentional,
// descriptive class (paired with an unrelated `svelte-xxxxx` hash, not a
// hash itself) and its count matched the real result count live, so it's
// used directly as a pragmatic fallback.
//
// Alaska's results layout has (at least) two variants depending on
// route/search, confirmed live on real runs:
//  (a) fare tiers listed directly in the row, e.g. "Main 45k points + $32
//      Round trip" — no extra step needed.
//  (b) a collapsed summary trigger per row, e.g. "Round trip from 55k
//      points pts + $32", which must be CLICKED to expand and reveal the
//      real selectable tier buttons within that SAME row, e.g.
//      "Refundable Main 55k points pts + $32  Round trip   last 3 seats".
// An earlier version tried to batch-expand every row's trigger up front
// using a page-wide button index. That broke: this turns out to be an
// accordion — expanding one row can cause ITS OWN trigger button to stop
// matching the "collapsed" locator, which silently shifts every
// subsequent `.nth(i)` index in a page-wide list, so a batch loop ends up
// skipping/double-toggling rows unpredictably. Scoping everything to one
// row's Locator (row.getByRole(...)) sidesteps this: only expand the ONE
// row being worked on, right when it's needed, and never touch a
// page-wide button index at all.

const TRIGGER_BUTTON_NAME = /^round trip from/i;
// Matches real, selectable fare-tier buttons in either layout variant,
// excluding the collapsed trigger (which also contains "round trip").
const FARE_BUTTON_NAME = /^(?!round trip from).*round trip/i;
const COOKIE_DISMISS_NAME = 'Dismiss';
const ADD_TO_CART_NAME = 'Add to cart';

const TIME_RE = /\b(\d{1,2}:\d{2}\s?[ap]m)\b/gi;
const DURATION_RE = /(\d+)h\s*(\d+)m/;
const FLIGHT_NUM_RE = /\b[A-Z]{2}\s?\d{2,5}\b/i;
const AIRPORT_RE = /\b([A-Z]{3})\b/g;
// Optional "Refundable " prefix and optional "pts" after "points" — both
// seen live, varying by fare-comparison layout variant.
const POINTS_FARE_RE =
  /^(?:Refundable\s+)?(Saver|Main|Premium|First|Business)\s+([\d.]+)k\s+points(?:\s+pts)?\s*\+\s*\$(\d+(?:\.\d+)?)/i;
const CASH_FARE_RE = /^(?:Refundable\s+)?(Saver|Main|Premium|First|Business)\s+\$([\d,]+(?:\.\d+)?)/i;

export interface ParsedFare {
  tier: string; // Saver | Main | Premium | First | Business
  points: number; // 0 in cash mode
  pointsCash: number; // co-pay in points mode, full price in cash mode
  cashOnly: number; // all-cash total, present in both modes when parseable
}

export interface CardInfo {
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
  // Either variant's buttons contain "round trip" somewhere.
  await page.getByRole('button', { name: /round trip/i }).first().waitFor({ timeout: 20_000 });
}

/** Every result row that represents a flight — filtered to ones containing
 * "round trip" so any non-flight `tr.matrixRow` (if any) is excluded. Row
 * count and order stay stable across expand/collapse (only a row's
 * CONTENT changes), unlike a page-wide button index. See module comment
 * for why this uses a class selector instead of the (here, non-functional)
 * ARIA row role. */
export function getCardRows(page: Page): Locator {
  return page.locator('tr.matrixRow').filter({ hasText: /round trip/i });
}

function parseFareText(text: string): ParsedFare | null {
  const normalized = text.trim().replace(/\s+/g, ' ');
  const pointsMatch = normalized.match(POINTS_FARE_RE);
  if (pointsMatch) {
    return {
      tier: pointsMatch[1],
      points: Math.round(Number(pointsMatch[2]) * 1000),
      pointsCash: Number(pointsMatch[3]),
      cashOnly: 0,
    };
  }
  const cashMatch = normalized.match(CASH_FARE_RE);
  if (cashMatch) {
    return {
      tier: cashMatch[1],
      points: 0,
      pointsCash: 0,
      cashOnly: Number(cashMatch[2].replace(/,/g, '')),
    };
  }
  return null;
}

/** Reads a row's flight info (flight number / duration / stops / times).
 * Available whether or not the row's fares are expanded — this text is
 * always rendered, only the fare tier buttons are ever collapsed. */
export async function extractCardInfo(row: Locator, originCode: string, destCode: string): Promise<CardInfo | null> {
  const raw = (await row.textContent()) ?? '';
  const text = raw.trim().replace(/\s+/g, ' ');

  const times = [...text.matchAll(TIME_RE)].map((m) => m[1]);
  if (times.length < 2) return null;

  const durationMatch = text.match(DURATION_RE);
  const durationMinutes = durationMatch ? Number(durationMatch[1]) * 60 + Number(durationMatch[2]) : 0;

  const flightNumMatch = text.match(FLIGHT_NUM_RE);
  const flightNumber = flightNumMatch ? flightNumMatch[0].toUpperCase() : 'Unknown';

  const codes = [...text.matchAll(AIRPORT_RE)].map((m) => m[1]);
  const stops = codes.filter((c) => c !== originCode && c !== destCode).length;

  return {
    flightNumber,
    durationMinutes,
    stops,
    departTime: times[0],
    arriveTime: times[times.length - 1],
  };
}

/** Selects the cheapest fare tier within a single row: expands its
 * collapsed trigger if present (variant (b); no-op if the row's fares are
 * already directly visible — variant (a)), reads the cheapest tier's
 * price, clicks it (advancing the SPA to the next step — return results
 * or trip summary), and returns what was selected. */
export async function selectCheapestFareInRow(row: Locator): Promise<ParsedFare | null> {
  const trigger = row.getByRole('button', { name: TRIGGER_BUTTON_NAME });
  if ((await trigger.count()) > 0) {
    await trigger.first().click();
    await row.getByRole('button', { name: FARE_BUTTON_NAME }).first().waitFor({ timeout: 5000 });
  }

  const fareButtons = row.getByRole('button', { name: FARE_BUTTON_NAME });
  const count = await fareButtons.count();
  if (count === 0) return null;

  // Cheapest is listed first (Saver < Main < Premium < First/Business, or
  // Main < First in points mode) — matches the discovered ordering.
  const first = fareButtons.first();
  const text = (await first.textContent()) ?? '';
  const fare = parseFareText(text);
  await first.click();
  return fare;
}

const TRIGGER_PRICE_POINTS_RE = /round trip from\s+([\d.]+)k\s+points(?:\s+pts)?\s*\+\s*\$(\d+(?:\.\d+)?)/i;
const TRIGGER_PRICE_CASH_RE = /round trip from\s+\$([\d,]+(?:\.\d+)?)/i;

/** Read-only cheapest-fare lookup — does NOT click anything. Needed when
 * browsing several rows' prices without committing to one (e.g. the top 3
 * return options): clicking a collapsed trigger to reveal its real tier
 * name would advance/consume that fare selection before the other two
 * rows have been read. Falls back to parsing the collapsed trigger's own
 * preview price ("Round trip from 55k points pts + $32") when the row
 * hasn't been expanded — verified live to already equal the cheapest
 * tier's real price, just without a tier name attached (reported as
 * "Cheapest" instead of e.g. "Main"). */
export async function previewCheapestFareInRow(row: Locator): Promise<ParsedFare | null> {
  const fareButtons = row.getByRole('button', { name: FARE_BUTTON_NAME });
  if ((await fareButtons.count()) > 0) {
    const text = (await fareButtons.first().textContent()) ?? '';
    const fare = parseFareText(text);
    if (fare) return fare;
  }

  const trigger = row.getByRole('button', { name: TRIGGER_BUTTON_NAME });
  if ((await trigger.count()) > 0) {
    const text = ((await trigger.first().textContent()) ?? '').trim().replace(/\s+/g, ' ');
    const pointsMatch = text.match(TRIGGER_PRICE_POINTS_RE);
    if (pointsMatch) {
      return {
        tier: 'Cheapest',
        points: Math.round(Number(pointsMatch[1]) * 1000),
        pointsCash: Number(pointsMatch[2]),
        cashOnly: 0,
      };
    }
    const cashMatch = text.match(TRIGGER_PRICE_CASH_RE);
    if (cashMatch) {
      return { tier: 'Cheapest', points: 0, pointsCash: 0, cashOnly: Number(cashMatch[1].replace(/,/g, '')) };
    }
  }

  return null;
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

function addMinutes(iso: string, mins: number): string {
  return new Date(new Date(iso).getTime() + mins * 60_000).toISOString();
}

export function cardInfoToLeg(info: CardInfo, fromCode: string, toCode: string, dateStr: string): FlightLeg {
  const departTime = toIso(dateStr, info.departTime);
  return {
    airline: 'Alaska Airlines',
    flightNumber: info.flightNumber,
    fromCode,
    toCode,
    departTime,
    // Derived from durationMinutes rather than re-parsing info.arriveTime's
    // clock time against the same calendar date — an overnight arrival
    // (next-day landing) has an arrival clock time numerically "earlier"
    // than departure, which would otherwise produce an arrival before its
    // own departure. Duration is unambiguous regardless of day rollover.
    arriveTime: addMinutes(departTime, info.durationMinutes),
    durationMinutes: info.durationMinutes,
    stops: info.stops,
  };
}

export function fareToPricing(
  fare: ParsedFare,
  params: SearchParams,
): Pick<FlightCard, 'cashPrice' | 'points' | 'pointsCash'> {
  if (params.usePoints) {
    return { cashPrice: 0, points: fare.points, pointsCash: fare.pointsCash };
  }
  return { cashPrice: fare.cashOnly, points: 0, pointsCash: 0 };
}
