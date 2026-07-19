export interface FlightLeg {
  airline: string;
  flightNumber: string;
  fromCode: string;
  toCode: string;
  departTime: string; // ISO 8601
  arriveTime: string; // ISO 8601
  durationMinutes: number;
  stops: number;
}

export interface FlightCard {
  id: string;
  outbound: FlightLeg;
  return?: FlightLeg;
  cashPrice: number;
  points: number;
  pointsCash: number;
}

export interface SearchParams {
  from: string;
  to: string;
  departDate: string;
  returnDate: string;
  passengers: number;
  usePoints: boolean;
}
