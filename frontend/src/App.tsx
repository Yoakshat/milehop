import { useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import Logo from './components/Logo'
import SearchBar from './components/SearchBar'
import FlightResultCard from './components/FlightResultCard'
import { bookFlight, openFlightStream } from './api/flightStream'
import type { BookingStatus, FlightCard, SearchQuery } from './types'
import './App.css'

export default function App() {
  const [cards, setCards] = useState<FlightCard[]>([])
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [bookingStatuses, setBookingStatuses] = useState<Record<string, BookingStatus>>({})
  const streamRef = useRef<{ close: () => void } | null>(null)

  function handleSearch(query: SearchQuery) {
    streamRef.current?.close()
    setCards([])
    setBookingStatuses({})
    setSearching(true)
    setHasSearched(true)

    streamRef.current = openFlightStream(
      query,
      (card) => {
        setCards((prev) =>
          [...prev, card].sort((a, b) => a.points + a.pointsCash * 100 - (b.points + b.pointsCash * 100)),
        )
      },
      () => setSearching(false),
      () => setSearching(false),
    )
  }

  async function handleBook(cardId: string) {
    setBookingStatuses((prev) => ({ ...prev, [cardId]: 'booking' }))
    try {
      const result = await bookFlight(cardId)
      setBookingStatuses((prev) => ({ ...prev, [cardId]: result.ok ? 'booked' : 'error' }))
    } catch {
      setBookingStatuses((prev) => ({ ...prev, [cardId]: 'error' }))
    }
  }

  const bestId = cards[0]?.id

  return (
    <div className="app">
      <div className="sky" />

      <header className="header">
        <div className="brand">
          <Logo />
          <span className="brand-name">Milehop</span>
        </div>
      </header>

      <main className="main">
        <SearchBar onSearch={handleSearch} searching={searching} />

        <div className="results">
          {!hasSearched && (
            <div className="empty-state">
              Search a route to compare cash and points deals side by side.
            </div>
          )}

          {hasSearched && cards.length === 0 && searching && (
            <div className="empty-state">Finding the best deals…</div>
          )}

          <AnimatePresence>
            {cards.map((card) => (
              <FlightResultCard
                key={card.id}
                card={card}
                isBest={card.id === bestId}
                bookingStatus={bookingStatuses[card.id] ?? 'idle'}
                onBook={handleBook}
              />
            ))}
          </AnimatePresence>
        </div>
      </main>
    </div>
  )
}
