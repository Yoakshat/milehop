import { motion } from 'framer-motion'
import type { BookingStatus, FlightCard, FlightLeg } from '../types'

interface FlightResultCardProps {
  card: FlightCard
  isBest: boolean
  bookingStatus: BookingStatus
  onBook: (id: string) => void
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m}m`
}

function stopsLabel(stops: number): string {
  return stops === 0 ? 'Direct' : `${stops} stop${stops > 1 ? 's' : ''}`
}

function LegRow({ leg }: { leg: FlightLeg }) {
  return (
    <div className="leg-row">
      <div className="leg-times">
        <span className="leg-time">{formatTime(leg.departTime)}</span>
        <span className="leg-arrow">→</span>
        <span className="leg-time">{formatTime(leg.arriveTime)}</span>
      </div>
      <div className="leg-route">
        {leg.fromCode} · {leg.toCode}
      </div>
      <div className="leg-meta">
        <span>{formatDuration(leg.durationMinutes)}</span>
        <span className="leg-dot">•</span>
        <span className={leg.stops === 0 ? 'stops-direct' : ''}>{stopsLabel(leg.stops)}</span>
      </div>
      <div className="leg-flight-number">{leg.flightNumber}</div>
    </div>
  )
}

export default function FlightResultCard({
  card,
  isBest,
  bookingStatus,
  onBook,
}: FlightResultCardProps) {
  const buttonLabel =
    bookingStatus === 'booking'
      ? 'Booking…'
      : bookingStatus === 'booked'
        ? 'Added to cart'
        : bookingStatus === 'error'
          ? 'Try again'
          : 'Book'

  return (
    <motion.div
      layout
      layoutId={card.id}
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      className={`flight-card ${isBest ? 'flight-card-best' : ''}`}
    >
      {isBest && <div className="best-badge">BEST DEAL</div>}

      <div className="flight-card-legs">
        <LegRow leg={card.outbound} />
        {card.return && (
          <>
            <div className="leg-separator" />
            <LegRow leg={card.return} />
          </>
        )}
      </div>

      <div className="flight-card-price">
        <div className="price-points">{card.points.toLocaleString()} pts</div>
        <div className="price-cash">+ ${card.pointsCash}</div>
        <div className="price-cash-only">${card.cashPrice} cash</div>
        <button
          className={`book-button ${bookingStatus}`}
          onClick={() => onBook(card.id)}
          disabled={bookingStatus === 'booking' || bookingStatus === 'booked'}
        >
          {buttonLabel}
        </button>
      </div>
    </motion.div>
  )
}
