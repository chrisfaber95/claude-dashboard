// Pure chat logic (no DOM, no network): text in, intent out, reply text from the current state. Testable with node --test.
import type { Alert, DashboardState, SessionInfo, TokenCounts } from '../shared/types/index.ts';
import { moodOf } from './mood.ts';

/** Result of looking a name, project or id prefix up among candidates. */
export type Match<T> = { kind: 'one'; item: T } | { kind: 'many'; items: T[] } | { kind: 'none' };

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

const norm = (s: string): string => s.trim().toLowerCase();

/** Picks the first tier (strongest match) that has any hit; several hits in that tier are ambiguous. */
function pick<T>(items: readonly T[], tiers: ReadonlyArray<(x: T) => boolean>): Match<T> {
  for (const hit of tiers) {
    const found = items.filter(hit);
    if (found.length === 1) return { kind: 'one', item: found[0] as T };
    if (found.length > 1) return { kind: 'many', items: found };
  }
  return { kind: 'none' };
}

export function matchSession(query: string, sessions: readonly SessionInfo[]): Match<SessionInfo> {
  const q = norm(query);
  if (!q) return { kind: 'none' };
  return pick(sessions, [
    (s) => norm(s.name) === q || norm(s.sessionId) === q,
    (s) => norm(s.project) === q,
    (s) => q.length >= 2 && norm(s.sessionId).startsWith(q),
    (s) => norm(s.name).startsWith(q),
    (s) => norm(s.name).includes(q),
    (s) => norm(s.project).includes(q),
  ]);
}

export function matchAlert(query: string, state: Pick<DashboardState, 'alerts' | 'sessions'>): Match<Alert> {
  const q = norm(query);
  const items = state.alerts?.items ?? [];
  if (!q) return { kind: 'none' };
  const projectOf = (a: Alert): string => {
    const id = a.id.startsWith('session:') ? a.id.slice('session:'.length) : '';
    return norm((state.sessions ?? []).find((s) => s.sessionId === id)?.project ?? '');
  };
  const bare = (a: Alert): string => norm(a.id.slice(a.id.indexOf(':') + 1));
  return pick(items, [
    (a) => norm(a.id) === q || norm(a.title) === q,
    (a) => projectOf(a) === q,
    (a) => q.length >= 2 && (norm(a.id).startsWith(q) || bare(a).startsWith(q)),
    (a) => norm(a.title).startsWith(q),
    (a) => norm(a.title).includes(q),
    (a) => projectOf(a).includes(q),
  ]);
}

export function parseIntent(text: string, state: Pick<DashboardState, 'alerts' | 'sessions'>): Intent {
  const t = text.trim();
  const sessions = state.sessions ?? [];

  const msg = MESSAGE_RE.exec(t);
  if (msg) {
    const query = msg[1] as string;
    return { kind: 'message', query, match: matchSession(query, sessions), text: msg[2] as string, needsConfirm: true };
  }
  // A verb followed by something that is no session or alert ("view usage", "clear alerts") may be a plain
  // question: only fall through to the keyword intents when nothing matched.
  const keyword = (): Intent =>
    ATTENTION_RE.test(t) ? { kind: 'attention' } : USAGE_RE.test(t) ? { kind: 'usage' } : STATUS_RE.test(t) ? { kind: 'status' } : { kind: 'help' };
  const ack = ACK_RE.exec(t);
  if (ack) {
    const match = matchAlert(ack[1] as string, state);
    if (match.kind !== 'none') return { kind: 'ack', query: ack[1] as string, match };
    return keyword().kind === 'help' ? { kind: 'ack', query: ack[1] as string, match } : keyword();
  }
  for (const [re, k] of [[SUMMARY_RE, 'summary'], [OPEN_RE, 'open']] as const) {
    const m = re.exec(t);
    if (!m) continue;
    const match = matchSession(m[1] as string, sessions);
    if (match.kind !== 'none') return { kind: k, query: m[1] as string, match };
    return keyword().kind === 'help' ? { kind: k, query: m[1] as string, match } : keyword();
  }
  return keyword();
}

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

export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

const sumTokens = (t: TokenCounts): number => t.input + t.output + t.cacheRead + t.cacheWrite;

function fmtReset(resetsAtMs: number | null, nowMs: number): string {
  if (resetsAtMs == null) return 'reset time unknown';
  const mins = Math.max(0, Math.round((resetsAtMs - nowMs) / 60000));
  if (mins < 1) return 'resets now';
  if (mins < 60) return `resets in ${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `resets in ${h}h ${mins % 60}m`;
  return `resets in ${Math.floor(h / 24)}d ${h % 24}h`;
}

const dayKey = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const candidates = (what: string, query: string, labels: string[]): string =>
  `"${query}" matches ${labels.length} ${what}s, which one?\n${labels.map((l) => `• ${l}`).join('\n')}`;

const sessionLabel = (s: SessionInfo): string => `${s.name} (${s.project}, ${s.sessionId.slice(0, 8)})`;
const alertLabel = (a: Alert): string => `${a.title}: ${a.detail} (${a.id})`;

function statusReply(state: DashboardState): string {
  const sessions = state.sessions ?? [];
  const working = (state.subagents ?? []).filter((a) => a.state === 'working').length;
  if (!sessions.length) return working ? `No live sessions, ${working} subagents still working.` : 'Nothing is running.';
  const lines = sessions.map((s) => `• ${s.name} (${s.project}): ${STATUS_WORD[moodOf(s)]}`);
  const sub = working ? `\n${working} ${working === 1 ? 'subagent' : 'subagents'} working.` : '';
  return `${sessions.length} live ${sessions.length === 1 ? 'session' : 'sessions'}:\n${lines.join('\n')}${sub}`;
}

function attentionReply(state: DashboardState): string {
  const items = state.alerts?.items ?? [];
  const needsYou = state.team?.needsYou ?? [];
  if (!items.length && !needsYou.length) return 'Nothing needs you right now.';
  const lines = [...items.map((a) => `• ${a.title}: ${a.detail}`), ...needsYou.map((n) => `• ${n}`)];
  return `${lines.length} ${lines.length === 1 ? 'thing needs' : 'things need'} you:\n${lines.join('\n')}`;
}

function usageReply(state: DashboardState): string {
  const days = state.usage?.days ?? [];
  const totals = state.usage?.totals;
  const today = days.find((d) => d.day === dayKey(state.generatedAtMs));
  const lines = totals ? [`Tokens in total: ${fmtTokens(sumTokens(totals))}`] : [];
  if (today) lines.push(`Tokens today: ${fmtTokens(sumTokens(today.tokens))}`);
  const windows = state.limits?.windows ?? [];
  if (!windows.length) lines.push('No limit data available.');
  for (const w of windows) {
    lines.push(`• ${w.label}: ${Math.round(w.utilization)}% used, ${fmtReset(w.resetsAtMs, state.generatedAtMs)}`);
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
      const m = intent.match;
      if (m.kind === 'none') return `No open alert matches "${intent.query}".`;
      if (m.kind === 'many') return candidates('alert', intent.query, m.items.map(alertLabel));
      return `Dismissing alert "${m.item.title}".`;
    }
    case 'message':
    case 'open':
    case 'summary': {
      const m = intent.match;
      if (m.kind === 'none') return `No session matches "${intent.query}".`;
      if (m.kind === 'many') return candidates('session', intent.query, m.items.map(sessionLabel));
      if (intent.kind === 'open') return `Opening ${m.item.name}.`;
      if (intent.kind === 'summary') return `Summary of ${m.item.name}:`;
      return `Send to ${m.item.name}: "${intent.text}"\nConfirm to send.`;
    }
  }
}
