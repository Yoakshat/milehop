import type { Request, Response } from 'express';
import { generateMockCards, nextStaggerDelayMs } from '../mock/mockFlights.js';
import { runAlaskaSearch } from '../browser/alaska-session.js';
import type { FlightCard, SearchParams } from '../types.js';

const USE_REAL_ALASKA = process.env.MILEHOP_REAL_ALASKA === '1';

function parseParams(req: Request): SearchParams | null {
  const { from, to, departDate, returnDate, passengers = '1', usePoints = 'false' } = req.query;
  if (!from || !to || !departDate || !returnDate) return null;
  return {
    from: String(from),
    to: String(to),
    departDate: String(departDate),
    returnDate: String(returnDate),
    passengers: Number(passengers) || 1,
    usePoints: String(usePoints) === 'true',
  };
}

/** GET /search/stream?from=..&to=..&departDate=..&returnDate=..&passengers=..&usePoints=..
 *
 * Server-Sent Events. Streams "flight" events (one FlightCard JSON payload
 * each) as they're found, then a final "done" event.
 *
 * Backed by mock data (src/mock/mockFlights.ts) by default. Set
 * MILEHOP_REAL_ALASKA=1 to drive the real site instead (src/browser/
 * alaska-session.ts) — requires the user's real Chrome fully quit first
 * (see chrome-launcher.ts) and has only been verified up to the point of
 * launching Chrome in this dev environment, not a full live run.
 */
export function handleSearchStream(req: Request, res: Response): void {
  const params = parseParams(req);
  if (!params) {
    res.status(400).json({ error: 'Missing required query params: from, to, departDate, returnDate' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendCard = (card: FlightCard) => res.write(`event: flight\ndata: ${JSON.stringify(card)}\n\n`);
  const sendDone = () => {
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
  };

  if (USE_REAL_ALASKA) {
    let closed = false;
    req.on('close', () => {
      closed = true;
    });
    runAlaskaSearch(params, (card) => {
      if (!closed) sendCard(card);
    })
      .then(() => {
        if (!closed) sendDone();
      })
      .catch((err) => {
        console.error('[search] runAlaskaSearch failed:', err);
        if (!closed) sendDone();
      });
    return;
  }

  const cards = generateMockCards(params);
  let i = 0;

  const sendNext = () => {
    if (i >= cards.length) {
      sendDone();
      return;
    }
    sendCard(cards[i++]);
    timer = setTimeout(sendNext, nextStaggerDelayMs());
  };

  let timer = setTimeout(sendNext, nextStaggerDelayMs());

  req.on('close', () => clearTimeout(timer));
}
