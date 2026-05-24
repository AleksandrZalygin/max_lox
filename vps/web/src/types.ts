export interface StationState {
  type: string;
  station_id: string;
  level_pct: number | null;
  volume_l: number | null;
  moisture_pct: number | null;
  pumps: boolean;
  mode: "manual" | "auto";
  target_level?: number;
}

export interface Measurement {
  id: number;
  station_id: string;
  timestamp: string;
  level_pct: number;
  volume_l: number;
  moisture_raw: number | null;
  moisture_pct: number | null;
}

export interface ApiEvent {
  id: number;
  station_id: string;
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
}
