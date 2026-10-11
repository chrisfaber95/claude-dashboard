// Pure chat logic (no DOM, no network): text in, intent out, reply text from the current state. Testable with node --test.
import type { Alert, DashboardState, SessionInfo, TokenCounts } from '../../../shared/types/index.ts';
import { moodOf } from '../core/mood.logic.ts';

/** Result of looking a name, project or id prefix up among candidates. */
export type Match<T> = { kind: 'one'; item: T } | { kind: 'many'; items: T[] } | { kind: 'none' };

/** What the user's chat line asks for. */
export type Intent =
  | { kind: 'status' }
  | { kind: 'attention' }
  | { kind: 'usage' }
  | { kind: 'help' }
  /** `text` is exactly what the user typed after the colon. The panel must ask for confirmation before sending. */
  | { kind: 'message'; query: string; match: Match<SessionInfo>; text: string; needsConfirm: true }
  | { kind: 'ack'; query: string; match: Match<Alert> }
  | { kind: 'open'; query: string; match: Match<SessionInfo> }
  | { kind: 'summary'; query: string; match: Match<SessionInfo> };

const MESSAGE_RE = /^(?:send|tell|message|msg)\s+(?:to\s+)?([^:]+?)\s*:\s*([\s\S]*\S)\s*$/i;
const ACK_RE = /^(?:ack(?:nowledge)?|dismiss|clear)\s+(?:alert\s+)?(.+?)\s*[.!?]*$/i;
const SUMMARY_RE = /^(?:summari[sz]e|summary(?:\s+(?:of|for))?|recap|tl;?dr)\s+(?:session\s+)?(.+?)\s*[.!?]*$/i;
const OPEN_RE = /^(?:open|view|go\s+to)\s+(?:session\s+)?(.+?)\s*[.!?]*$/i;
const ATTENTION_RE = /\b(?:needs?|wants?|waiting|attention|alerts?|blocked|stuck)\b/i;
const USAGE_RE = /\b(?:usage|tokens?|limits?|quota|resets?|how\s+much)\b/i;
const STATUS_RE = /\b(?:running|status|working|busy|active|sessions?|going\s+on|up\s+to)\b/i;

const MIN_PREFIX_LENGTH = 2;
const SESSION_ID_PREFIX_LENGTH = 8;
const BILLION = 1e9;
const MILLION = 1e6;
const THOUSAND = 1e3;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

const normalize = (text: string): string => text.trim().toLowerCase();

/** One capture group of a match whose pattern always fills it. */
const groupOf = (match: RegExpExecArray, index: number): string => match[index] ?? '';

/** Picks the first tier (strongest match) that has any hit; several hits in that tier are ambiguous. */
function pick<T>(items: readonly T[], tiers: ReadonlyArray<(x: T) => boolean>): Match<T> {
  for (const hit of tiers) {
    const found = items.filter(hit);
    const [first] = found;
    if (found.length === 1 && first !== undefined) return { kind: 'one', item: first };
    if (found.length > 1) return { kind: 'many', items: found };
  }
  return { kind: 'none' };
}

/** Find the session a name, project or id prefix refers to. */
export function matchSession(query: string, sessions: readonly SessionInfo[]): Match<SessionInfo> {
  const needle = normalize(query);
  if (!needle) return { kind: 'none' };
  return pick(sessions, [
    (session) => normalize(session.name) === needle || normalize(session.sessionId) === needle,
    (session) => normalize(session.project) === needle,
    (session) => needle.length >= MIN_PREFIX_LENGTH && normalize(session.sessionId).startsWith(needle),
    (session) => normalize(session.name).startsWith(needle),
    (session) => normalize(session.name).includes(needle),
    (session) => normalize(session.project).includes(needle),
  ]);
}

/** Find the alert a title, id or project name refers to. */
export function matchAlert(query: string, state: Pick<DashboardState, 'alerts' | 'sessions'>): Match<Alert> {
  const needle = normalize(query);
  const items = state.alerts?.items ?? [];
  if (!needle) return { kind: 'none' };
  const projectOf = (alert: Alert): string => {
    const id = alert.id.startsWith('session:') ? alert.id.slice('session:'.length) : '';
    return normalize((state.sessions ?? []).find((session) => session.sessionId === id)?.project ?? '');
  };
  const bare = (alert: Alert): string => normalize(alert.id.slice(alert.id.indexOf(':') + 1));
  return pick(items, [
    (alert) => normalize(alert.id) === needle || normalize(alert.title) === needle,
    (alert) => projectOf(alert) === needle,
    (alert) => needle.length >= MIN_PREFIX_LENGTH && (normalize(alert.id).startsWith(needle) || bare(alert).startsWith(needle)),
    (alert) => normalize(alert.title).startsWith(needle),
    (alert) => normalize(alert.title).includes(needle),
    (alert) => projectOf(alert).includes(needle),
  ]);
}

/** Turn a chat line into an intent; anything unrecognised becomes `help`. */
export function parseIntent(text: string, state: Pick<DashboardState, 'alerts' | 'sessions'>): Intent {
  const trimmed = text.trim();
  const sessions = state.sessions ?? [];

  const messageMatch = MESSAGE_RE.exec(trimmed);
  if (messageMatch) {
    const query = groupOf(messageMatch, 1);
    return { kind: 'message', query, match: matchSession(query, sessions), text: groupOf(messageMatch, 2), needsConfirm: true };
  }
  // A verb followed by something that is no session or alert ("view usage", "clear alerts") may be a plain
  // question: only fall through to the keyword intents when nothing matched.
  const keyword = (): Intent => {
    if (ATTENTION_RE.test(trimmed)) return { kind: 'attention' };
    if (USAGE_RE.test(trimmed)) return { kind: 'usage' };
    if (STATUS_RE.test(trimmed)) return { kind: 'status' };
    return { kind: 'help' };
  };
  const ack = ACK_RE.exec(trimmed);
  if (ack) {
    const query = groupOf(ack, 1);
    const match = matchAlert(query, state);
    if (match.kind !== 'none') return { kind: 'ack', query, match };
    return keyword().kind === 'help' ? { kind: 'ack', query, match } : keyword();
  }
  for (const [pattern, kind] of [[SUMMARY_RE, 'summary'], [OPEN_RE, 'open']] as const) {
    const verbMatch = pattern.exec(trimmed);
    if (!verbMatch) continue;
    const query = groupOf(verbMatch, 1);
    const match = matchSession(query, sessions);
    if (match.kind !== 'none') return { kind, query, match };
    return keyword().kind === 'help' ? { kind, query, match } : keyword();
  }
  return keyword();
}

/** The reply to `help` and to anything the parser does not understand. */
export const HELP_TEXT = [
  'I answer from what the dashboard shows. Try:',
  '• "what\'s running?": live sessions and their status',
  '• "what needs me?": open alerts',
  '• "usage" or "limits": tokens and limit windows',
  '• "tell <session>: <text>": send a message (asks you to confirm first)',
  '• "dismiss <alert>": dismiss an alert',
  '• "open <session>": open its transcript',
  '• "summarize <session>": recap of a session',
  'Sessions and alerts match by name, project or id prefix.',
].join('\n');

const STATUS_WORD = { busy: 'working', waiting: 'waiting for you', idle: 'idle' } as const;

/** Format a token count as 1.2k, 3.4M or 1.5B. */
export function fmtTokens(count: number): string {
  if (count >= BILLION) return `${(count / BILLION).toFixed(1)}B`;
  if (count >= MILLION) return `${(count / MILLION).toFixed(1)}M`;
  if (count >= THOUSAND) return `${(count / THOUSAND).toFixed(1)}k`;
  return String(Math.round(count));
}

const sumTokens = (tokens: TokenCounts): number => tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;

function fmtReset(resetsAtMs: number | null, nowMs: number): string {
  if (resetsAtMs == null) return 'reset time unknown';
  const mins = Math.max(0, Math.round((resetsAtMs - nowMs) / MS_PER_MINUTE));
  if (mins < 1) return 'resets now';
  if (mins < MINUTES_PER_HOUR) return `resets in ${mins}m`;
  const hours = Math.floor(mins / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `resets in ${hours}h ${mins % MINUTES_PER_HOUR}m`;
  return `resets in ${Math.floor(hours / HOURS_PER_DAY)}d ${hours % HOURS_PER_DAY}h`;
}

const dayKey = (ms: number): string => {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const candidates = (what: string, query: string, labels: string[]): string =>
  `"${query}" matches ${labels.length} ${what}s, which one?\n${labels.map((label) => `• ${label}`).join('\n')}`;

const sessionLabel = (session: SessionInfo): string =>
  `${session.name} (${session.project}, ${session.sessionId.slice(0, SESSION_ID_PREFIX_LENGTH)})`;
const alertLabel = (alert: Alert): string => `${alert.title}: ${alert.detail} (${alert.id})`;

function statusReply(state: DashboardState): string {
  const sessions = state.sessions ?? [];
  const working = (state.subagents ?? []).filter((subagent) => subagent.state === 'working').length;
  if (!sessions.length) return working ? `No live sessions, ${working} subagents still working.` : 'Nothing is running.';
  const lines = sessions.map((session) => `• ${session.name} (${session.project}): ${STATUS_WORD[moodOf(session)]}`);
  const sub = working ? `\n${working} ${working === 1 ? 'subagent' : 'subagents'} working.` : '';
  return `${sessions.length} live ${sessions.length === 1 ? 'session' : 'sessions'}:\n${lines.join('\n')}${sub}`;
}

function attentionReply(state: DashboardState): string {
  const items = state.alerts?.items ?? [];
  const needsYou = state.team?.needsYou ?? [];
  if (!items.length && !needsYou.length) return 'Nothing needs you right now.';
  const lines = [...items.map((alert) => `• ${alert.title}: ${alert.detail}`), ...needsYou.map((entry) => `• ${entry}`)];
  return `${lines.length} ${lines.length === 1 ? 'thing needs' : 'things need'} you:\n${lines.join('\n')}`;
}

function usageReply(state: DashboardState): string {
  const days = state.usage?.days ?? [];
  const totals = state.usage?.totals;
  const today = days.find((usageDay) => usageDay.day === dayKey(state.generatedAtMs));
  const lines = totals ? [`Tokens in total: ${fmtTokens(sumTokens(totals))}`] : [];
  if (today) lines.push(`Tokens today: ${fmtTokens(sumTokens(today.tokens))}`);
  const windows = state.limits?.windows ?? [];
  if (!windows.length) lines.push('No limit data available.');
  for (const limitWindow of windows) {
    lines.push(`• ${limitWindow.label}: ${Math.round(limitWindow.utilization)}% used, ${fmtReset(limitWindow.resetsAtMs, state.generatedAtMs)}`);
  }
  return lines.join('\n');
}

/** Builds the reply text for an intent from the same fields the dashboard shows. Tokens only, never cost. */
export function answer(intent: Intent, state: DashboardState): string {
  switch (intent.kind) {
    case 'status':
      return statusReply(state);
    case 'attention':
      return attentionReply(state);
    case 'usage':
      return usageReply(state);
    case 'help':
      return HELP_TEXT;
    case 'ack': {
      const match = intent.match;
      if (match.kind === 'none') return `No open alert matches "${intent.query}".`;
      if (match.kind === 'many') return candidates('alert', intent.query, match.items.map(alertLabel));
      return `Dismissing alert "${match.item.title}".`;
    }
    case 'message':
    case 'open':
    case 'summary': {
      const match = intent.match;
      if (match.kind === 'none') return `No session matches "${intent.query}".`;
      if (match.kind === 'many') return candidates('session', intent.query, match.items.map(sessionLabel));
      if (intent.kind === 'open') return `Opening ${match.item.name}.`;
      if (intent.kind === 'summary') return `Summary of ${match.item.name}:`;
      return `Send to ${match.item.name}: "${intent.text}"\nConfirm to send.`;
    }
  }
}
