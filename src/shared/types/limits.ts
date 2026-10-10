export interface LimitWindow {
  key: string;
  label: string;
  utilization: number; // percent 0..100
  resetsAtMs: number | null;
}

export interface LimitHit {
  tsMs: number;
  type: string;
  resetsAtMs: number | null;
  project: string;
}

export interface LimitsInfo {
  source: 'live' | 'cache' | 'none';
  fetchedAtMs: number | null;
  error: string | null;
  windows: LimitWindow[];
  hits: LimitHit[];
}
