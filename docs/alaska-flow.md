# Alaska Airlines flow — discovered live, 2026-07-19

Verified by driving the real site with an authenticated Chrome session (no
form-filling needed at runtime — direct URL navigation works).

## 1. Direct search URL (skips the homepage form entirely)

```
https://www.alaskaair.com/search/results?O={ORIGIN}&D={DEST}&OD={YYYY-MM-DD}&DD={YYYY-MM-DD}&A={numPassengers}&RT=true&ShoppingMethod={onlineaward|revenue}&locale=en-us
```

- `O` / `D` — origin/destination airport codes (e.g. `SAN`, `JFK`)
- `OD` / `DD` — outbound date / return date, `YYYY-MM-DD`
- `A` — number of adult passengers
- `RT` — `true` for round trip
- `ShoppingMethod=onlineaward` — points + cash pricing (what "Use points" means)
- `ShoppingMethod=revenue` — cash-only pricing, more fare tiers shown (Saver/Main/Premium/First vs just Main/First for points)
- One-time per session: a cookie-consent dialog appears (`button "Dismiss"`) — dismiss it once, it doesn't reappear.

No login/cookies needed to see pricing in either mode. Login is only required later, at real checkout past "Add to cart" (out of scope for this demo).

## 2. Outbound results page (`Depart: {O}–{D}` heading)

This is a client-rendered SPA — cards mutate in place, no full navigation. Wait for the `Loading...` placeholders to resolve, then the page shows a status text `"{N} Results"` and a list of result cards. Each card:

- Flight number / "Multiple flights" if there's a connection
- Duration (e.g. `5h 49m`, sometimes with `+1 day`)
- Departure time + origin code, arrival time + destination code
- Stop indicator: `Nonstop` or a connection airport code (e.g. `SEA`)
- One fare button per available cabin, each a single clickable button whose accessible name is exactly the string to parse, e.g.:
  - Points mode: `"Main 45k points + $32 Round trip"`, `"First 82.5k points + $32 Round trip Recliner last 3 seats"`
  - Cash mode: `"Saver $434 Round trip"`, `"Main $544 Round trip"`, `"Premium $687 Round trip"`, `"First $1,497 Round trip Recliner last 3 seats"`
  - Trailing text like `last N seats` is scarcity messaging, safe to ignore/strip.
- Only 10 cards render initially; `"Show more results"` button loads more (pagination, not needed if we only want the top 5 as returned/sorted by the site's default "Sorted by: Stops").

Top 5 = first 5 cards in DOM order.

## 3. Clicking an outbound fare button

Clicking any fare button on an outbound card transitions the **same page** (still the same URL) to `Return: {D}–{O}` — the identical card/fare-button structure, now for return flights. A date-strip of selectable return dates with point/price previews appears above the list. Take the top 3 fare-button cards the same way as step 2 (or top 3 fare options within — see note below on 2 vs 4 fare tiers).

## 4. Clicking a return fare button

Transitions to a **Trip summary** page (still same URL) showing:
- Departing card (read-only, with a "Change flight" button)
- Returning card (read-only, with a "Change flight" button)
- `"Total: {points}k points + ${cash} per person, round trip"` (or `"Total: ${cash} ..."` in cash mode)
- `button "Add to cart"` — this is the actual "Book" action. Clicking it is the demo's stopping point (per product decision — no further checkout/payment). Alaska may prompt for login at or after this point; that's expected and out of scope to automate.

## 5. Parallelism model for the runtime script

Because steps 3/4 mutate the SAME page rather than navigating to a new URL, you cannot explore multiple outbound options from one tab. To get 5 outbound options streaming in parallel with their own top-3 return options:

1. Open 5 tabs, each `goto()` the same results URL from step 1.
2. In tab *i*, wait for results, grab the outbound card list, click the fare button on outbound card *i* (0-indexed) — this is what makes tab *i* "own" outbound option *i*.
3. Extract that tab's outbound summary (already known before clicking, but confirm post-click) + top 3 return fare options from the resulting Return page.
4. Stream each (outbound, one-of-3-returns) pairing back as an individual card the moment tab *i* has it — 5 tabs streaming in parallel is what gives the "cards streaming in live" effect, no need to wait for all 5 to finish.
5. Keep all 5 tabs open and alive — when the user clicks "Book" on a given card, resume that exact tab (it already has the right outbound leg selected), click the matching return fare button if not already selected, then click "Add to cart".

## Update 2026-07-19: verified end-to-end against the live site, real add-to-cart confirmed

The scripted flow (`backend/src/browser/alaska-scraper.ts` + `alaska-session.ts`) was run for real (5 parallel tabs, `MILEHOP_REAL_ALASKA=1`) and confirmed working, including a real `Add to Cart` click. Corrections/discoveries from that run, superseding some assumptions above:

- **Two results-list layout variants exist**, not accounted for originally:
  (a) fare tiers listed directly in each row (what steps 2-4 above describe), or
  (b) each row shows a **collapsed summary trigger** instead — accessible name `"Round trip from 55k points pts + $32"` — which must be clicked to expand and reveal the real per-tier buttons *within that same row*, now named e.g. `"Refundable Main 55k points pts + $32  Round trip   last 3 seats"` (note the `Refundable ` prefix and `points pts` phrasing, both absent in variant (a)). Which variant renders appears to depend on route/search, not a fixed site behavior.
- **It's an accordion**: expanding one row's fares can cause that row's own trigger button to stop matching a "still collapsed" locator — which silently shifts every subsequent index in a *page-wide* button list. A batch "expand every row up front" approach breaks from this (verified: caused most rows to be skipped/double-toggled). Fix: never track a page-wide button index — scope everything to one row's `Locator` at a time (expand-then-read one row, move to next), which sidesteps the accordion entirely.
- **Rows aren't reachable via `getByRole('row')`** despite being real, populated `<tr class="matrixRow ...">` elements — their CSS sets `display: grid`, and per the HTML accessibility mapping spec that strips a `<tr>`'s implicit ARIA `row` role. `tr.matrixRow` (a plain CSS class, but an evidently intentional/descriptive one, not a hash) is used instead as a pragmatic fallback.
- **The collapsed trigger's own price preview already equals the cheapest tier's real price** (just without a tier name attached) — confirmed by expanding and comparing. This means the top-3 *return* rows can be read (for streaming as cards) without ever clicking/committing to any of them, preserving all 3 options; only the user's actual chosen one gets clicked-and-committed later, at `/book` time.
- **Add to Cart opens the cart in a NEW tab**, not a navigation of the current one — confirmed live: the original tab reverted to browsing (back on the return-results list), while a separate new tab opened at `alaskaair.com/search/cart?...F1=...&F2=...&AWARDS=true&award_matrix_selection=...`, whose fare-matrix query params matched the exact outbound+return combo that had been selected. The app doesn't currently track/report this new cart tab back to the user — it isn't needed for the demo's stopping point, but would be if a future version wanted to surface the cart URL directly.
- Overnight (next-day-arrival) flights need arrival time derived from `departTime + durationMinutes`, not by parsing the arrival row's clock time against the same calendar date — the clock time alone can't distinguish same-day from next-day landing and produced an arrival-before-departure bug on a real result before this fix.
- One flight-number extraction gap remains: connecting ("Multiple flights") itineraries sometimes have no single "AS ####"-style code anywhere in the row's visible text (only shown behind "Details"), so `flightNumber` falls back to `"Unknown"` for those — a real, accepted limitation, not a bug.
- Rate-limiting on 5 simultaneous tabs is real, not just a theoretical risk: in one live run, 2 of 5 tabs failed with a `page.goto` timeout while 3 succeeded. Not yet fixed (the existing 250ms stagger wasn't enough in that run) — a longer stagger or a retry would be the next thing to try.
