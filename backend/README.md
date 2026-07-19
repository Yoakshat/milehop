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
`docs/alaska-flow.md`. Alaska's SPA doesn't expose stable CSS classes, but
its fare buttons have a stable, parseable **accessible name** (e.g. `"Main
45k points + $32 Round trip"`), which is what `page.getByRole('button',
{ name })` and in-page regex parsing key off — the same structure verified
live via accessibility-tree snapshots when the flow was discovered.

- `buildSearchUrl()` — direct URL navigation, no form-filling (`O`/`D`/`OD`/
  `DD`/`A`/`RT`/`ShoppingMethod`).
- `extractCards()` — runs once via `page.evaluate()`: finds every fare
  button, groups siblings sharing a parent (one flight's fare tiers), walks
  up each group's ancestors to the nearest one containing 2+ "h:mm am/pm"
  times (the card boundary), then regex-parses flight number / duration /
  times, and counts non-origin/non-destination 3-letter airport codes in
  the card as stops.
- `alaska-session.ts` opens 5 tabs (staggered 250ms), each claims one
  outbound option by index, clicks its cheapest fare (morphs that same tab
  into return results — Alaska doesn't navigate to a new URL for this),
  and streams its top-3 return options as `FlightCard`s. Alaska recomputes
  each return-stage fare button to already be the full round-trip total
  once an outbound leg is locked in (verified live), so no outbound+return
  math is needed. Tabs stay open so `/book` can resume the exact right one.

**Not yet verified end-to-end against the live site** — written from the
confirmed accessible-name structure, but this dev sandbox has no real
Chrome/display to run it in. Do a real run and sanity-check the parsed
card data before trusting it fully; the DOM-grouping/ancestor-walk
heuristic in particular is the part most likely to need a small tweak
against real markup.

## Browser automation foundation

`src/browser/chrome-launcher.ts` + `src/browser/context-manager.ts` are
ported from `~/projects/voyage/main/src/main/browser/` (Electron app that
already solved CDP-driven Chrome automation), adapted for a plain Node
server and — importantly — to connect to the **user's real Chrome profile**
rather than a copied/dedicated debug profile, so search results reuse the
user's actual Alaska Airlines login/cookies with no separate sign-in step.

`connectToRealChrome()` (in `context-manager.ts`) launches/attaches to real
`Google Chrome.app` with `--remote-debugging-port` against
`~/Library/Application Support/Google/Chrome` (profile `Default`), connects
Playwright over CDP, and returns `{ browser, context, openTab, listTabs,
getTab, closeTab }`.

**Before using it, fully quit Chrome (Cmd+Q, not just closing windows).**
Chrome only honors `--remote-debugging-port` on a fresh launch — if an
instance is already running against your normal profile, the flag is
silently ignored and `connectToRealChrome()` will time out waiting for the
CDP port.

Manual smoke test (just the connection, not the scraper):

```
npm run test:chrome-connect
```

opens a new tab and navigates to google.com. This has not been verified
end-to-end in a sandboxed CI-style environment (no real display/Chrome
available there) — needs to be run on a real macOS desktop session with
Chrome installed and fully quit first.
