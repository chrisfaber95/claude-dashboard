export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageDay {
  day: string; // YYYY-MM-DD (local)
  byProject: Record<string, number>;
  byModel: Record<string, number>;
  tokens: TokenCounts;
}
