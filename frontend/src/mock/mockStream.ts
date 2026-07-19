import type { FlightCard, SearchQuery } from '../types'

const MOCK_CARDS: FlightCard[] = [
  {
    id: 'mock-1',
    outbound: {
      airline: 'Alaska Airlines',
      flightNumber: 'AS 1402',
      fromCode: 'SFO',
      toCode: 'JFK',
      departTime: '2026-08-14T07:15:00',
      arriveTime: '2026-08-14T15:42:00',
      durationMinutes: 327,
      stops: 0,
    },
    return: {
      airline: 'Alaska Airlines',
      flightNumber: 'AS 24',
      fromCode: 'JFK',
      toCode: 'SFO',
      departTime: '2026-08-21T18:05:00',
      arriveTime: '2026-08-21T21:30:00',
      durationMinutes: 325,
      stops: 0,
    },
    cashPrice: 486,
    points: 42000,
    pointsCash: 11,
  },
  {
    id: 'mock-2',
    outbound: {
      airline: 'Alaska Airlines',
      flightNumber: 'AS 680',
      fromCode: 'SEA',
      toCode: 'JFK',
      departTime: '2026-08-14T06:30:00',
      arriveTime: '2026-08-14T14:58:00',
      durationMinutes: 328,
      stops: 0,
    },
    return: {
      airline: 'Alaska Airlines',
      flightNumber: 'AS 705',
      fromCode: 'JFK',
      toCode: 'SEA',
      departTime: '2026-08-21T19:20:00',
      arriveTime: '2026-08-21T22:15:00',
      durationMinutes: 355,
      stops: 0,
    },
    cashPrice: 512,
    points: 38500,
    pointsCash: 24,
  },
  {
    id: 'mock-3',
    outbound: {
      airline: 'Alaska Airlines',
      flightNumber: 'AS 1187',
      fromCode: 'SFO',
      toCode: 'JFK',
      departTime: '2026-08-14T11:00:00',
      arriveTime: '2026-08-14T22:47:00',
      durationMinutes: 407,
      stops: 1,
    },
    return: {
      airline: 'Alaska Airlines',
      flightNumber: 'AS 512',
      fromCode: 'JFK',
      toCode: 'SFO',
      departTime: '2026-08-21T09:10:00',
      arriveTime: '2026-08-21T12:55:00',
      durationMinutes: 345,
      stops: 0,
    },
    cashPrice: 401,
    points: 51000,
    pointsCash: 5,
  },
  {
    id: 'mock-4',
    outbound: {
      airline: 'Alaska Airlines',
      flightNumber: 'AS 34',
      fromCode: 'SEA',
      toCode: 'JFK',
      departTime: '2026-08-14T22:00:00',
      arriveTime: '2026-08-15T06:22:00',
      durationMinutes: 322,
      stops: 0,
    },
    return: {
      airline: 'Alaska Airlines',
      flightNumber: 'AS 41',
      fromCode: 'JFK',
      toCode: 'SEA',
      departTime: '2026-08-21T07:00:00',
      arriveTime: '2026-08-21T09:48:00',
      durationMinutes: 348,
      stops: 0,
    },
    cashPrice: 559,
    points: 35000,
    pointsCash: 32,
  },
  {
    id: 'mock-5',
    outbound: {
      airline: 'Alaska Airlines',
      flightNumber: 'AS 891',
      fromCode: 'SFO',
      toCode: 'JFK',
      departTime: '2026-08-14T16:40:00',
      arriveTime: '2026-08-15T01:05:00',
      durationMinutes: 325,
      stops: 0,
    },
    return: {
      airline: 'Alaska Airlines',
      flightNumber: 'AS 118',
      fromCode: 'JFK',
      toCode: 'SFO',
      departTime: '2026-08-21T13:45:00',
      arriveTime: '2026-08-21T17:12:00',
      durationMinutes: 327,
      stops: 0,
    },
    cashPrice: 470,
    points: 45000,
    pointsCash: 15,
  },
]

export interface MockStreamHandle {
  close: () => void
}

export function openMockStream(
  _query: SearchQuery,
  onCard: (card: FlightCard) => void,
  onDone: () => void,
): MockStreamHandle {
  const timers: ReturnType<typeof setTimeout>[] = []
  let elapsed = 0

  MOCK_CARDS.forEach((card) => {
    elapsed += 400 + Math.random() * 400
    const t = setTimeout(() => onCard(card), elapsed)
    timers.push(t)
  })

  const doneTimer = setTimeout(onDone, elapsed + 300)
  timers.push(doneTimer)

  return {
    close: () => timers.forEach(clearTimeout),
  }
}
