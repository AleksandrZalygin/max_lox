export interface StationState {
  station_id: string;
  level_pct: number | null;
  volume_l: number | null;
  moisture_pct: number | null;
  pumps: boolean;
  mode: "manual" | "auto";
  target_level: number;
}

export interface Station {
  id: string;
  name: string;
  description: string;
  calibration: {
    distance_empty: number;
    distance_full: number;
    length_cm: number;
    width_cm: number;
    height_cm: number;
  };
  created_at: string;
  level_pct: number | null;
  volume_l: number | null;
  moisture_pct: number | null;
  pumps: boolean;
  mode: string;
  target_level: number;
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

declare global {
  interface Window {
    api: {
      call: (method: string, path: string, body?: unknown) => Promise<unknown>;
    };
  }
}
