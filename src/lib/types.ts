export interface Line {
  id: string;
  short_name: string;
  long_name: string;
  color: string;
  text_color: string;
  pattern_ids: string[];
  route_ids?: string[];
}

export interface Stop {
  id: string;
  lat: number;
  lon: number;
  long_name: string;
  line_ids?: string[];
}

export interface PatternStop {
  stop_id: string;
  stop_sequence: number;
  /** distância acumulada ao longo da shape, em km */
  distance: number;
}

export interface Pattern {
  id: string;
  line_id: string;
  short_name: string;
  headsign: string;
  direction_id: number;
  shape_id: string;
  color: string;
  text_color: string;
  path: PatternStop[];
}

export interface Shape {
  shape_id: string;
  /** comprimento em metros */
  extension: number;
  geojson: { geometry: { coordinates: [number, number][] } };
}

/** Posição de veículo do hub TML (/vehicles/positions) */
export interface HubVehicle {
  vehicle_id: string;
  agency_id: string;
  route_short_name: string | null;
  pattern_id: string | null;
  route_id: string | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  /** assumido km/h (mediana 18, máx. 102 nas medições) */
  speed: number | null;
  stop_id: string | null;
  current_status: string | null;
  received_at: number;
  direction_id: string | null;
}

export interface Arrival {
  line_id: string;
  pattern_id: string;
  headsign: string;
  scheduled_arrival: string;
  scheduled_arrival_unix: number;
  estimated_arrival_unix: number | null;
  observed_arrival_unix: number | null;
  stop_sequence: number;
}

export interface Alert {
  cause: string;
  effect: string;
  header_text: { translation: { language: string; text: string }[] };
  description_text: { translation: { language: string; text: string }[] };
  active_period: { start: number; end: number }[];
  informed_entity: { route_id?: string; stop_id?: string; agency_id?: string }[];
}

/** Remove o prefixo de agência: "[LA77N]1001_0_2" → "1001_0_2" */
export const stripAgency = (id: string) => id.replace(/^\[[^\]]*\]/, "");
