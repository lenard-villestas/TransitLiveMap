// API contracts (frozen backend). Keep these in sync with build_map.py /
// server.py — the same "do not change the array format" rule applies here.

// [lat, lon, route_short, color, headsign, vehicle_id, route_type, trip_id, shape_id]
export type VehicleTuple = [
  number, number, string, string, string, string, string, string | null, string | null,
];

// [lat, lon, name, stop_id]
export type StopTuple = [number, number, string, string];

export interface Shape {
  shape_id: string;
  coords: [number, number][];   // [lat, lon] pairs
  color: string;
}

export interface NetworkResponse {
  shapes: Shape[];
  stops: StopTuple[];
}

export interface VehiclesResponse {
  vehicles: VehicleTuple[];
  ts: number;
  matched: number;
  age: number | null;
}

export interface EtaArrival {
  route: string;
  headsign: string;
  color: string;
  type: string;
  trip_id: string | null;
  vehicle_id: string | null;
  arrival: number;       // epoch seconds
  eta_seconds: number;
}

export interface StopEtaResponse {
  stop_id: string;
  arrivals: EtaArrival[];
  ts: number;
}

export interface NextStopResponse {
  stop_id: string | null;
  arrival?: number;
  eta_seconds?: number;
  route?: string;
  headsign?: string;
  ts?: number;
}
