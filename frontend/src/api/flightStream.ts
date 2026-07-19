import type { FlightCard, SearchQuery } from '../types'
import { openMockStream } from '../mock/mockStream'

const API_BASE = 'http://localhost:4000'

export interface FlightStreamHandle {
  close: () => void
}

function isMockMode(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('mock') !== '0'
}

export function openFlightStream(
  query: SearchQuery,
  onCard: (card: FlightCard) => void,
  onDone: () => void,
  onError: (err: unknown) => void,
): FlightStreamHandle {
  if (isMockMode()) {
    return openMockStream(query, onCard, onDone)
  }

  const params = new URLSearchParams({
    from: query.from,
    to: query.to,
    departDate: query.departDate,
    passengers: String(query.passengers),
    usePoints: String(query.usePoints),
  })
  if (query.returnDate) params.set('returnDate', query.returnDate)

  const source = new EventSource(`${API_BASE}/search/stream?${params.toString()}`)

  source.addEventListener('flight', (event) => {
    try {
      const card = JSON.parse((event as MessageEvent).data) as FlightCard
      onCard(card)
    } catch (err) {
      onError(err)
    }
  })

  source.addEventListener('done', () => {
    onDone()
    source.close()
  })

  source.onerror = (err) => {
    onError(err)
    source.close()
  }

  return {
    close: () => source.close(),
  }
}

export async function bookFlight(cardId: string): Promise<{ ok: boolean }> {
  if (isMockMode()) {
    await new Promise((resolve) => setTimeout(resolve, 900 + Math.random() * 600))
    return { ok: true }
  }

  const res = await fetch(`${API_BASE}/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId }),
  })
  return { ok: res.ok }
}
