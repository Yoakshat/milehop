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

Currently backed entirely by mock data (`src/mock/mockFlights.ts`) so the
API can be exercised standalone. That module is the only thing that needs
to be swapped for a real Playwright/Alaska-scraper implementation later —
routes/server code doesn't change.

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

Stub for now. The real implementation will resume that card's live browser
tab (opened during search) and drive it through fare selection to Alaska's
add-to-cart page — wired in later once Alaska's selectors are known.

## Browser automation foundation (not yet wired in)

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

Nothing calls this yet. Manual smoke test:

```
npm run test:chrome-connect
```

opens a new tab and navigates to google.com. This has not been verified
end-to-end in a sandboxed CI-style environment (no real display/Chrome
available there) — needs to be run on a real macOS desktop session with
Chrome installed and fully quit first.
