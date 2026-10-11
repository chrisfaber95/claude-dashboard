import type { TokenCounts } from '../../shared/types/index.ts';

const BILLION = 1e9;
const MILLION = 1e6;
const THOUSAND = 1e3;

/** Format a token count as 1.2k, 3.40M or 1.50B. */
export function formatTokenCount(tokenCount: number): string {
  if (tokenCount >= BILLION) return `${(tokenCount / BILLION).toFixed(2)}B`;
  if (tokenCount >= MILLION) return `${(tokenCount / MILLION).toFixed(2)}M`;
  if (tokenCount >= THOUSAND) return `${(tokenCount / THOUSAND).toFixed(1)}k`;
  return String(tokenCount);
}

/** Sum every token kind of one usage record. */
export const sumTokens = (tokens: TokenCounts): number => tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
