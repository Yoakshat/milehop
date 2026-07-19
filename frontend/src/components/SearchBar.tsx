import { useState } from 'react'
import type { FormEvent } from 'react'
import type { SearchQuery } from '../types'

interface SearchBarProps {
  onSearch: (query: SearchQuery) => void
  searching: boolean
}

export default function SearchBar({ onSearch, searching }: SearchBarProps) {
  const [from, setFrom] = useState('SFO')
  const [to, setTo] = useState('JFK')
  const [departDate, setDepartDate] = useState('2026-08-14')
  const [returnDate, setReturnDate] = useState('2026-08-21')
  const [passengers, setPassengers] = useState(1)
  const [usePoints, setUsePoints] = useState(true)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSearch({
      from: from.trim().toUpperCase(),
      to: to.trim().toUpperCase(),
      departDate,
      returnDate: returnDate || undefined,
      passengers,
      usePoints,
    })
  }

  return (
    <form className="search-bar" onSubmit={handleSubmit}>
      <div className="search-field">
        <label htmlFor="from">From</label>
        <input
          id="from"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          maxLength={3}
          placeholder="SFO"
        />
      </div>
      <div className="search-divider" />
      <div className="search-field">
        <label htmlFor="to">To</label>
        <input
          id="to"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          maxLength={3}
          placeholder="JFK"
        />
      </div>
      <div className="search-divider" />
      <div className="search-field search-field-dates">
        <label>Dates</label>
        <div className="date-inputs">
          <input
            type="date"
            value={departDate}
            onChange={(e) => setDepartDate(e.target.value)}
          />
          <span className="date-sep">–</span>
          <input
            type="date"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
          />
        </div>
      </div>
      <div className="search-divider" />
      <div className="search-field search-field-narrow">
        <label htmlFor="passengers">Passengers</label>
        <input
          id="passengers"
          type="number"
          min={1}
          max={9}
          value={passengers}
          onChange={(e) => setPassengers(Number(e.target.value))}
        />
      </div>
      <div className="search-divider" />
      <button
        type="button"
        className={`points-toggle ${usePoints ? 'on' : ''}`}
        onClick={() => setUsePoints((v) => !v)}
        aria-pressed={usePoints}
      >
        <span className="points-toggle-track">
          <span className="points-toggle-thumb" />
        </span>
        Use points
      </button>
      <button type="submit" className="search-button" disabled={searching}>
        {searching ? 'Searching…' : 'Search'}
      </button>
    </form>
  )
}
