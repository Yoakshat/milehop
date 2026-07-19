export interface FlightLeg {
  airline: string
  flightNumber: string
  fromCode: string
  toCode: string
  departTime: string
  arriveTime: string
  durationMinutes: number
  stops: number
}

export interface FlightCard {
  id: string
  outbound: FlightLeg
  return?: FlightLeg
  cashPrice: number
  points: number
  pointsCash: number
}

export interface SearchQuery {
  from: string
  to: string
  departDate: string
  returnDate?: string
  passengers: number
  usePoints: boolean
}

export type BookingStatus = 'idle' | 'booking' | 'booked' | 'error'
