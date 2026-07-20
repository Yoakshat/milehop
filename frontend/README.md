# Milehop Frontend

React + Vite (TypeScript) SPA, dark-themed flight search UI. Runs on
`http://localhost:3000`.

## How to run

```
cd frontend
npm install
npm run dev
```

By default the app hits the **real backend** at `http://localhost:4000`
(run it with `MILEHOP_REAL_ALASKA=1` for the live Alaska Airlines flow —
see `backend/README.md`). Append `?mock=1` to the URL, e.g.
`http://localhost:3000/?mock=1`, to fall back to simulated cards
(staggered fake SSE stream, no backend needed) for standalone UI demoing.

## Backend contract (must match exactly)

### 1. Search stream

The frontend opens a single `EventSource` (GET-only, so all params are in
the query string — no separate `POST /search` call is made):

```
GET http://localhost:4000/search/stream?from=SFO&to=JFK&departDate=2026-08-14&returnDate=2026-08-21&passengers=1&usePoints=true
```

Query params:
| param | type | notes |
|---|---|---|
| `from` | string | 3-letter airport code, uppercased |
| `to` | string | 3-letter airport code, uppercased |
| `departDate` | string | `YYYY-MM-DD` |
| `returnDate` | string | `YYYY-MM-DD`, omitted if one-way |
| `passengers` | string (number) | e.g. `"1"` |
| `usePoints` | string (boolean) | `"true"` / `"false"` |

The server should respond with an SSE stream (`Content-Type: text/event-stream`)
and emit:

- One `event: flight` per result, as soon as it's found, with `data` being a
  JSON-encoded `FlightCard` (shape below).
- One `event: done` (empty data is fine) once the stream is finished, after
  which the frontend closes the connection.

Example event:

```
event: flight
data: {"id":"as-1402-jfk","outbound":{...},"return":{...},"cashPrice":486,"points":42000,"pointsCash":11}

```

### `FlightCard` JSON shape

```ts
interface FlightLeg {
  airline: string        // e.g. "Alaska Airlines"
  flightNumber: string   // e.g. "AS 1402"
  fromCode: string       // 3-letter airport code
  toCode: string         // 3-letter airport code
  departTime: string     // ISO 8601 local datetime, e.g. "2026-08-14T07:15:00"
  arriveTime: string     // ISO 8601 local datetime
  durationMinutes: number
  stops: number          // 0 = direct
}

interface FlightCard {
  id: string             // unique, stable — used as the Book payload and React key
  outbound: FlightLeg
  return?: FlightLeg      // omitted for one-way searches
  cashPrice: number       // all-cash price in USD, for reference
  points: number          // points required for this fare
  pointsCash: number      // USD co-pay required on top of points (the "+ $11")
}
```

The frontend sorts/re-sorts the list live as cards arrive, ascending by
`points + pointsCash * 100` (i.e. points is the primary signal, cash co-pay
is a tiebreaker-ish secondary term) — lowest first is the "BEST DEAL".

### 2. Book

```
POST http://localhost:4000/book
Content-Type: application/json

{ "cardId": "as-1402-jfk" }
```

Frontend only checks `response.ok` today — treats any 2xx as booked, any
non-2xx (or network error) as failed. No response body is required yet, but
returning something like `{ "ok": true }` is a reasonable default to build
toward.

## Key files

- `src/types.ts` — shared `FlightCard` / `FlightLeg` / `SearchQuery` types.
- `src/api/flightStream.ts` — the only module that knows about mock vs. real
  mode (`?mock=1` opts into mock; real backend is the default) and the
  SSE/fetch calls.
- `src/mock/mockStream.ts` — mock data + staggered fake SSE stream. Safe to
  delete entirely once not needed; only `flightStream.ts` imports it.
- `src/components/SearchBar.tsx` — pill search bar (From/To/Dates/Passengers/
  Use Points toggle/Search button).
- `src/components/FlightResultCard.tsx` — one flight result card (outbound +
  return legs, points+cash price, Book button, BEST DEAL badge).
- `src/App.tsx` — page shell, owns search + streaming + sort state.
