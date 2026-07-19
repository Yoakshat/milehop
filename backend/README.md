# milehop backend

Node/TypeScript Express server on port 4000. Built in parallel with the
frontend; the two landed with slightly different contracts (frontend's
README didn't exist yet when this backend was scaffolded). Reconciled to
match `frontend/README.md` exactly — see below.

## Run

```
npm install
npm run dev
```

Server listens on `http://localhost:4000`.

## API

### `GET /search/stream`

Server-Sent Events endpoint. Streams 5 flight cards as they're "found",
staggered 400-800ms apart, then a final `done` event and closes the
connection.

**Query params** (all required except `passengers`/`usePoints`, which
default to `1`/`false`):

| param        | type    | example      |
|--------------|---------|--------------|
| `from`       | string  | `SEA`        |
| `to`         | string  | `SFO`        |
| `departDate` | string  | `2026-08-01` (YYYY-MM-DD) |
| `returnDate` | string  | `2026-08-08` (YYYY-MM-DD) |
| `passengers` | number  | `1`          |
| `usePoints`  | boolean | `true`       |

**Events:**

- `event: flight` — one per flight result, `data` is a JSON `FlightCard`:

  ```ts
  interface FlightLeg {
    airline: string;
    flightNumber: string;
    fromCode: string;   // IATA code
    toCode: string;      // IATA code
    departTime: string;  // ISO 8601
    arriveTime: string;  // ISO 8601
    durationMinutes: number;
    stops: number;
  }

  interface FlightCard {
    id: string;
    outbound: FlightLeg;
    return?: FlightLeg;  // omitted for one-way
    cashPrice: number;   // all-cash USD price, for reference
    points: number;      // points required
    pointsCash: number;  // USD co-pay on top of points
  }
  ```

  No `isBest`/`airline`-at-top-level fields — the frontend computes "best
  deal" client-side (ascending `points + pointsCash * 100`) and `airline`
  lives per-leg.

- `event: done` — `data: {}`, sent once after all 5 cards, then the
  connection closes.

Example client usage:

```js
const es = new EventSource(`http://localhost:4000/search/stream?${params}`);
es.addEventListener('flight', (e) => addCard(JSON.parse(e.data)));
es.addEventListener('done', () => es.close());
```

By default backed by mock data (`src/mock/mockFlights.ts`) so the API can
be exercised standalone. Set `MILEHOP_REAL_ALASKA=1` to drive the real
site instead (`src/browser/alaska-session.ts` + `alaska-scraper.ts`) — see
"Real Alaska scraper" below.

### `POST /book`

```
POST /book
Content-Type: application/json

{ "cardId": "flight-2-1234567890" }
```

Response (after a simulated ~0.6-1s delay):

```json
{ "status": "added_to_cart" }
```

Mock-mode stub by default. With `MILEHOP_REAL_ALASKA=1`, resumes that
card's live browser tab, selects its return fare, and clicks Add to Cart —
returns `409 { status: "failed", reason }` if the tab/card can't be
resumed.

## Real Alaska scraper (`MILEHOP_REAL_ALASKA=1`)

`src/browser/alaska-scraper.ts` + `alaska-session.ts` implement the real
search/book flow **deterministically — no LLM calls at runtime**, per
`docs/alaska-flow.md`. **Verified end-to-end on a real run**: real search
results streamed from all working tabs, and a real `Add to Cart` click
confirmed via a new `alaskaair.com/search/cart?...` tab whose fare-matrix
params matched the selected outbound+return combo exactly.

- `buildSearchUrl()` — direct URL navigation, no form-filling (`O`/`D`/`OD`/
  `DD`/`A`/`RT`/`ShoppingMethod`).
- Everything is **row-scoped**: `getCardRows()` returns one `Locator` per
  result row (`tr.matrixRow` — not `getByRole('row')`, which matches
  nothing here since these rows use `display: grid`, and per the HTML
  accessibility mapping spec that strips a `<tr>`'s implicit ARIA `row`
  role). Row count/order stays stable across expand/collapse, unlike a
  page-wide button index — an earlier version tracked fare buttons by
  global index and broke on a real run (Alaska's fare-tier reveal is an
  accordion: expanding one row can un-render its own trigger button,
  silently shifting every later index).
- `extractCardInfo(row, ...)` reads flight number/duration/stops/times —
  always visible, whether or not that row's fares are expanded.
- `selectCheapestFareInRow(row)` expands the row's collapsed fare trigger
  if present (some routes/searches render fares already-expanded; others
  collapse them behind a `"Round trip from Xk points..."` summary that
  needs a click first) and clicks the cheapest tier — this **commits** to
  that row, so it's only used for the outbound leg and for the final
  booked return leg.
- `previewCheapestFareInRow(row)` reads a row's cheapest price **without
  clicking anything** — needed for the return rows, since committing to
  one before reading the others would lose them. Falls back to parsing
  the collapsed trigger's own preview price when unexpanded (verified
  live to already equal the real cheapest tier's price).
- `alaska-session.ts` opens up to 5 outbound tabs, each claims one
  outbound row by index, commits to its cheapest fare (morphs that same
  tab into return results — Alaska doesn't navigate to a new URL for
  this), and streams previews of **every** return row as `FlightCard`s
  (free once the return page has loaded — just text/regex, no clicks).
  Alaska recomputes each return row's fare to already be the full
  round-trip total once an outbound leg is locked in (verified live), so
  no outbound+return math is needed. Tabs stay open, nothing further
  clicked, so `/book` can resume the exact right tab and commit to the
  specific return row the user picked.
  - **Tab loading is sequential, tab processing is concurrent.** A tab's
    *initial* load (goto + cookie-dismiss + wait for fares) is the
    expensive part — 5 tabs hitting it near-simultaneously (only 250ms
    apart) caused 2 of 5 to fail with a `page.goto` timeout on one real
    run. Fix: each tab's initial load is awaited fully before the next
    tab's load even starts; only the cheaper post-load work (commit to a
    row, wait for the return page, read every row) runs concurrently
    across tabs once loaded. Verified live: all 5 tabs then succeeded
    (vs. 2 failures before), ~40s total for 5 outbound options x up to
    10 return rows each (up to 50 cards/search).

Known gap from the real run, not yet fixed: connecting ("Multiple
flights") itineraries sometimes have no visible single flight-number code
in the row text (only behind "Details") — `flightNumber` falls back to
`"Unknown"` for those, a real limitation.

## Browser automation foundation

`src/browser/chrome-launcher.ts` + `context-manager.ts` + `chrome-profile.ts`
are ported from `~/projects/voyage/main/src/main/browser/` (Electron app
that already solved CDP-driven Chrome automation), adapted for a plain
Node server.

**This does NOT CDP-attach to your actual default Chrome profile — it
can't.** As of Chrome 136+, Google blocks `--remote-debugging-port` from
attaching to the default profile directory specifically, to prevent
malware from exfiltrating cookies/sessions via CDP (the exact door this
app would otherwise be using). Instead, `chrome-profile.ts`'s
`ensureChromeProfile()` makes a **one-time copy** of your real profile
(`~/Library/Application Support/Google/Chrome/Default` + top-level `Local
State`, excluding heavy dirs like `Cache`/`History`/`IndexedDB`) into
`~/Library/Application Support/milehop/chrome-profile`, and Chrome is
launched against that copy — carrying over real cookies/logins (including
any Alaska Airlines session) without ever touching the live default
profile. The copy happens once and is skipped on later runs; call
`refreshChromeProfile()` to force a re-copy if a session cookie expires.

**Before the FIRST run, fully quit Chrome (Cmd+Q, not just closing
windows).** The copy step reads your real profile's SQLite `Cookies` file
directly off disk — doing that while Chrome has it open risks copying an
inconsistent snapshot. After that first copy, your normal Chrome can stay
open for all future runs; this connects to its own separate profile and
process.

`connectToRealChrome()` (in `context-manager.ts`) calls
`ensureChromeProfile()`, launches/attaches to real `Google Chrome.app`
against that copied profile with `--remote-debugging-port`, connects
Playwright over CDP, and returns `{ browser, context, openTab, listTabs,
getTab, closeTab }`.

Manual smoke test (just the connection, not the scraper):

```
npm run test:chrome-connect
```

opens a new tab and navigates to google.com. This has not been verified
end-to-end in a sandboxed CI-style environment (no real display/Chrome
available there) — needs to be run on a real macOS desktop session, with
Chrome fully quit before the first run so the profile copy can happen
cleanly.
