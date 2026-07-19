# Project: Milehop

## Overview
Standalone web app (localhost:3000) that finds the best Alaska Airlines
cash+points flight deal. User enters From/To/dates/passengers/points-toggle
once and hits search; flight cards stream in live as a real (visible,
non-headless) Chrome browser — driven via CDP against a one-time COPY of
the user's real Chrome profile (search itself needs no login at all;
Chrome 136+ blocks CDP from attaching to the actual default profile, so a
copy is required, not optional — see backend/README.md) — works through
Alaska's site: top 5 outbound results, then top 3 fare options inside each.
Cards auto-reorder by lowest total points as results stream in. Clicking
"Book" on the winning card drives that flight's real tab through fare
selection to Alaska's add-to-cart page and stops (no real purchase; login
handled manually by the user if Alaska prompts for it at that step).
**The full real flow — search through a real Add to Cart — has been run
and verified end-to-end against the live site** (2026-07-19).

## Tech Stack
- Frontend: React + Vite, dark UI inspired by a flight-search screenshot
  (own logo), SSE client for streaming card updates.
- Backend: Node/TypeScript (Express), SSE endpoint for streaming results to
  the frontend as they're found.
- Browser automation: Playwright connected over CDP to the user's real
  Chrome.app (their actual profile — reuses existing cookies/login, not a
  fresh isolated profile). No headless mode, no fingerprint-spoofing
  needed — a real visible profile already avoids the bot-detection that
  matters here.
- Orchestration: Claude Agent SDK subagents drive discovery/exploration;
  the actual runtime search/scrape flow is a deterministic Playwright script
  (fast, no LLM round-trip per click) once selectors are known, ported from
  a sibling project (`~/projects/voyage/main`) which already has working
  patterns for: launching/reusing a CDP-connected Chrome
  (`chrome-launcher.ts`), tab-tree ownership across parallel tabs
  (`context-manager.ts`), and a human-in-the-loop ask/answer tool for the
  login-required booking step (`ask-user.ts`).

## Architecture
1. **Selector discovery** (done, one-time — `docs/alaska-flow.md`): Alaska's
   search is a URL-driven SPA — no form-filling needed. Direct navigation:
   `alaskaair.com/search/results?O=..&D=..&OD=..&DD=..&A=..&RT=true&ShoppingMethod={onlineaward|revenue}`
   (`onlineaward` = points+cash, `revenue` = cash-only). Clicking an outbound
   fare button morphs the *same tab* into return-flight results; clicking a
   return fare button morphs it into a Trip Summary page with an
   `Add to cart` button. Because this mutates one tab rather than
   navigating, exploring 5 outbound branches in parallel requires 5 separate
   tabs, each independently clicking "its" outbound option.
2. **Runtime flow** (contract implemented; mock-data-backed by default,
   real scraper implemented and wired in behind `MILEHOP_REAL_ALASKA=1` —
   see Deferred for what's not yet verified):
   - `GET /search/stream?from=&to=&departDate=&returnDate=&passengers=&usePoints=`
     — single SSE connection (no separate POST), emits `event: flight` per
     result (`FlightCard` JSON — see `frontend/README.md`/`backend/README.md`
     for the exact shape) then `event: done`.
   - Frontend cards appear incrementally and re-sort live, ascending by
     `points + pointsCash * 100` — lowest first gets the "BEST DEAL" badge.
   - `POST /book { cardId }` — stub today (~1s simulated delay, returns
     `{status:"added_to_cart"}`); real version will resume that card's tab,
     select the return fare if needed, click Add to Cart, and stop there.

## Key Files
- `docs/alaska-flow.md` — discovered Alaska Airlines URL/click flow, the
  spec the real scraper implementation should follow
- `frontend/src/api/flightStream.ts` — mock vs. real SSE/book switch
  (`?mock=0` toggles real backend); only file that changes as backend work
  lands
- `frontend/src/mock/mockStream.ts`, `backend/src/mock/mockFlights.ts` —
  isolated mock data generators, each the one place to swap for the real
  implementation on its side
- `frontend/src/components/{SearchBar,FlightResultCard,Logo}.tsx`,
  `frontend/src/App.tsx` — UI
- `backend/src/routes/{search,book}.ts`, `backend/src/server.ts` — Express
  SSE/book endpoints
- `backend/src/browser/{chrome-launcher,context-manager,chrome-profile}.ts`
  — ported from `~/projects/voyage/main`; `chrome-profile.ts` makes the
  one-time copy of the user's real Chrome profile that CDP attaches to
  (see backend/README.md for why a copy, not the live default, is
  required)

## How to Run
```
cd backend && npm install && npm run dev     # http://localhost:4000
cd frontend && npm install && npm run dev    # http://localhost:3000 (mock mode)
```
Append `?mock=0` to the frontend URL to hit the real backend instead of the
built-in mock stream (both currently mock-data-backed, but going through
the real SSE/HTTP contract end-to-end rather than the frontend's own fake
timer).

## Deferred (explicitly, not forgotten)
- Real Alaska scraper (`backend/src/browser/alaska-scraper.ts` +
  `alaska-session.ts`, `MILEHOP_REAL_ALASKA=1`) is **run and verified**
  against the live site — real search results, real Add to Cart confirmed
  via the resulting cart tab's fare-matrix params. Known gaps (see
  `docs/alaska-flow.md`'s 2026-07-19 update): 5 simultaneous tabs
  sometimes hit rate-limiting (2 of 5 failed in one run; the 250ms stagger
  isn't always enough); connecting itineraries sometimes report
  `flightNumber: "Unknown"` (no single flight code visible without
  clicking "Details").
- Real login-gated checkout past "Add to cart" (explicitly out of scope for
  this demo)
