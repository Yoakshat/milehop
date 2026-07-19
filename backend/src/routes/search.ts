import type { Request, Response } from 'express';
import { generateMockCards, nextStaggerDelayMs } from '../mock/mockFlights.js';
import type { SearchParams } from '../types.js';

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
 * Server-Sent Events. Streams 5 "flight" events (one FlightCard JSON payload
 * each), staggered 400-800ms apart, then a final "done" event.
 *
 * Currently backed by mock data (src/mock/mockFlights.ts). Swapping to the
 * real Alaska-scraper implementation later only requires changing what
 * populates `cards` below.
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

  const cards = generateMockCards(params);
  let i = 0;

  const sendNext = () => {
    if (i >= cards.length) {
      res.write(`event: done\ndata: {}\n\n`);
      res.end();
      return;
    }
    const card = cards[i++];
    res.write(`event: flight\ndata: ${JSON.stringify(card)}\n\n`);
    timer = setTimeout(sendNext, nextStaggerDelayMs());
  };

  let timer = setTimeout(sendNext, nextStaggerDelayMs());

  req.on('close', () => clearTimeout(timer));
}
