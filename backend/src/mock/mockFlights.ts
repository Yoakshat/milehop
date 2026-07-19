import type { FlightCard, SearchParams } from '../types.js';

// Isolated mock data source. This is the ONLY module that needs to be swapped
// out (for a real Playwright/Alaska-scraper-backed generator) once selectors
// are discovered — everything else just consumes `generateMockCards()`.

const FLIGHT_NUMBERS = ['AS 24', 'AS 1402', 'AS 36', 'AS 2314', 'AS 3232'];

const ROUTES = [
  { depTime: '07:05', durationMinutes: 197, stops: 0 },
  { depTime: '09:40', durationMinutes: 258, stops: 0 },
  { depTime: '12:15', durationMinutes: 335, stops: 1 },
  { depTime: '15:30', durationMinutes: 222, stops: 0 },
  { depTime: '19:00', durationMinutes: 299, stops: 1 },
];

function isoAt(dateStr: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function addMinutes(iso: string, mins: number): string {
  return new Date(new Date(iso).getTime() + mins * 60_000).toISOString();
}

/** Generates 5 mock flight cards for the given search, in random-ish shuffled
 * order (like results trickling in from real scraping). Deterministic enough
 * per call to be usable for demoing, randomized enough to look "live". */
export function generateMockCards(params: SearchParams): FlightCard[] {
  const shuffled = [...ROUTES].sort(() => Math.random() - 0.5);

  return shuffled.map((route, i) => {
    const departTime = isoAt(params.departDate, route.depTime);
    const arriveTime = addMinutes(departTime, route.durationMinutes);
    const retDepartTime = isoAt(params.returnDate, route.depTime);
    const retArriveTime = addMinutes(retDepartTime, route.durationMinutes);
    const flightNumber = FLIGHT_NUMBERS[i % FLIGHT_NUMBERS.length];

    const points = (12_500 + Math.round(Math.random() * 15_000)) * params.passengers;
    const pointsCash = Math.round((10 + Math.random() * 25) * params.passengers);
    const cashPrice = Math.round((180 + Math.random() * 260) * params.passengers);

    return {
      id: `flight-${i + 1}-${Date.now()}`,
      outbound: {
        airline: 'Alaska Airlines',
        flightNumber,
        fromCode: params.from,
        toCode: params.to,
        departTime,
        arriveTime,
        durationMinutes: route.durationMinutes,
        stops: route.stops,
      },
      return: {
        airline: 'Alaska Airlines',
        flightNumber,
        fromCode: params.to,
        toCode: params.from,
        departTime: retDepartTime,
        arriveTime: retArriveTime,
        durationMinutes: route.durationMinutes,
        stops: route.stops,
      },
      cashPrice,
      points: Math.round(points / 100) * 100,
      pointsCash,
    };
  });
}

/** Random stagger delay (ms) between streamed cards, per spec: 400-800ms. */
export function nextStaggerDelayMs(): number {
  return 400 + Math.round(Math.random() * 400);
}
