# Project: Milehop

## Overview
Standalone web app (localhost:3000) that finds the best Alaska Airlines
cash+points flight deal. User enters From/To/dates/passengers/points-toggle
once and hits search; flight cards stream in live as a real (visible,
non-headless) Chrome browser — driven via CDP against the user's own Chrome
profile/cookies, no fresh login needed for search — works through Alaska's
site: top 5 outbound results, then top 3 fare options inside each. Cards
auto-reorder by lowest total points as results stream in. Clicking "Book" on
the winning card drives that flight's real tab through fare selection to
Alaska's add-to-cart page and stops (no real purchase; login handled
manually by the user if Alaska prompts for it at that step).

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
1. **Selector discovery** (one-time, semi-manual): explore Alaska's real
   site via browser tools to record the DOM selectors/flow needed for
   search results, per-flight fare options, and add-to-cart — saved as a
   config/script, not re-derived by an LLM at runtime.
2. **Runtime flow**:
   - `POST /search` with `{from, to, dates, passengers, usePoints}`
   - Backend connects to the user's real Chrome via CDP, navigates to
     Alaska, fills the search form, submits.
   - Scrapes top 5 outbound results (cash + points pricing).
   - Opens each of the 5 in its own tab **in parallel**, scrapes top 3 fare
     options per tab.
   - Streams each card over SSE as soon as it's found; frontend cards
     appear incrementally and re-sort by lowest total points live.
   - `POST /book` for the winning card: resumes that flight's tab, selects
     the chosen fare, clicks Add to Cart, stops (pauses for manual login if
     Alaska requires it).

## Key Files
_To be filled in as we build._

## How to Run
_To be filled in as we build._
