import type { DashboardState, MessageInfo, SessionInfo, TokenCounts, UsageDay } from '../shared/types.ts';
import { initBuilding, updateBuilding } from './building.ts';
import { initControls, updateControls } from './controls.ts';
import { initCore, updateCore } from './core.ts';
import { ensureRootScene } from './root-scene.ts';
import { parseSkin } from './skin.ts';
import type { Skin } from './skin.ts';
import { renderTeam } from './team.ts';
import { $, ago, api, esc } from './util.ts';

const fmt = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);

const total = (t: TokenCounts) => t.input + t.output + t.cacheRead + t.cacheWrite;

function until(ms: number | null): string {
  if (!ms) return 'no reset scheduled';
  const s = (ms - Date.now()) / 1000;
  if (s <= 0) return 'resetting now';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `resets in ${d ? `${d}d ` : ''}${h || d ? `${h}h ` : ''}${m}m`;
}

function uptime(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// Project colour follows the project (alphabetical, fixed order), never its rank.
let colorOf = (_name: string) => 'var(--s1)';
let tintOf = (_name: string) => 'tint-1';
function setColors(names: string[]) {
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  const slot = (n: string) => {
    const i = sorted.indexOf(n);
    return i >= 0 && i < 8 ? i + 1 : 0;
  };
  colorOf = (n) => (slot(n) ? `var(--s${slot(n)})` : 'var(--muted)');
  tintOf = (n) => (slot(n) ? `tint-${slot(n)}` : 'tint-muted');
}

const tip = $('tip');
// Tooltips are plain text (newlines allowed): attribute values come back entity-decoded, so never use innerHTML here.
function showTip(e: MouseEvent, text: string) {
  tip.textContent = text;
  tip.hidden = false;
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - w - 8)}px`;
  tip.style.top = `${e.clientY + 14}px`;
}
const hideTip = () => (tip.hidden = true);

document.addEventListener('mousemove', (e) => {
  const t = (e.target as Element).closest('[data-tip]');
  if (t) showTip(e, t.getAttribute('data-tip')!);
  else hideTip();
});

// ---- sections ----

// Rebuilding #limits restarts the gauge sweep animation, so skip the write when nothing changed.
let limitsHtml = '';
function renderLimits(s: DashboardState) {
  const l = s.limits;
  const gauges = l.windows
    .map((w) => {
      const pct = Math.max(0, Math.min(100, w.utilization));
      const cls = pct >= 90 ? 'is-crit' : pct >= 75 ? 'is-warn' : '';
      const status = pct >= 90 ? ' · near limit' : pct >= 75 ? ' · high' : '';
      return `<div class="gauge">
        <div class="gauge__row"><span>${esc(w.label)}</span><span class="gauge__value">${Math.round(pct)}%</span></div>
        <div class="gauge__track" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(w.label)} usage">
          <div class="gauge__fill ${cls}" style="width:${pct}%"></div></div>
        <div class="sub">${esc(until(w.resetsAtMs))}${status}</div></div>`;
    })
    .join('');
  const hits = l.hits.length
    ? `<p class="sub">Last limit hits: ${l.hits
        .slice(-3)
        .reverse()
        .map((h) => `${esc(h.type)} ${ago(h.tsMs)} (${esc(h.project)})`)
        .join(' · ')}</p>`
    : '';
  const src =
    l.source === 'live'
      ? `live · updated ${ago(l.fetchedAtMs)}`
      : l.source === 'cache'
        ? `from Claude Code's local cache · updated ${ago(l.fetchedAtMs)}`
        : 'no limit data';
  const html = `<h2 id="h-limits">Subscription limits</h2>
    ${gauges ? `<div class="gauges">${gauges}</div>` : '<div class="empty">No limit data available.</div>'}
    <p class="sub">${esc(src)}${l.error ? ` · ${esc(l.error)}` : ''}</p>${hits}`;
  if (html === limitsHtml) return;
  limitsHtml = html;
  $('limits').innerHTML = html;
}

function renderProjects(s: DashboardState) {
  const subsWorking = (project: string) => s.subagents.filter((a) => a.project === project && a.state === 'working').length;
  // The cards are re-rendered on every push; keep keyboard focus on the one the user is on.
  const focused = document.activeElement?.closest('[data-building]')?.getAttribute('data-building') ?? null;
  $('projects').innerHTML = `<h2 id="h-projects">Projects</h2><div class="grid">${s.projects
    .map(
      (p) => `<div class="card card--click" data-building="${esc(p.name)}" role="button" tabindex="0" aria-label="${esc(`Open the ${p.name} building`)}">
        <div class="card__head"><span><span class="card__swatch" style="background:${colorOf(p.name)}"></span>${esc(p.name)}</span>
          <span class="badge ${p.liveSessions ? 'badge--live' : ''}">${p.liveSessions ? `${p.liveSessions} live` : 'idle'}</span></div>
        <div class="sub">${p.branch ? esc(p.branch) : 'no git'}${p.isWorktree ? ' · worktree' : ''}${
          s.features.commands && !p.trusted ? ' · <span data-tip="Run claude once in this folder and accept the trust prompt to allow background tasks.">not trusted for tasks</span>' : ''
        }</div>
        <div class="sub">active ${ago(p.lastActiveMs)}${subsWorking(p.name) ? ` · ${subsWorking(p.name)} subagent${subsWorking(p.name) === 1 ? '' : 's'} working` : ''}</div>
        <div class="sub">today ${fmt(p.tokensToday)} · 7d ${fmt(p.tokens7d)} tokens</div></div>`,
    )
    .join('')}</div>`;
  if (focused) $('projects').querySelector<HTMLElement>(`[data-building="${CSS.escape(focused)}"]`)?.focus();
}

function renderSessions(s: DashboardState) {
  const cmds = s.features.commands;
  const rows = s.sessions
    .map((x: SessionInfo) => {
      const bg = x.kind === 'background' || x.kind === 'bg';
      const actions = [
        `<button class="btn btn--sm" data-view="${esc(x.sessionId)}" data-name="${esc(x.name)}">View</button>`,
        ...(cmds && bg
          ? [
              `<button class="btn btn--sm" data-logs="${esc(x.sessionId)}" data-name="${esc(x.name)}">Logs</button>`,
              `<button class="btn btn--sm" data-stop="${esc(x.sessionId)}" data-name="${esc(x.name)}">Stop</button>`,
            ]
          : []),
      ].join(' ');
      return `<tr>
      <td><span class="dot ${x.status === 'busy' ? 'is-busy' : x.status === 'idle' ? 'is-idle' : ''}"></span>${esc(x.name)}${bg ? ' <span class="badge">background</span>' : ''}</td>
      <td>${esc(x.project)}</td><td>${esc(x.status)}</td><td>${x.branch ? esc(x.branch) : '—'}</td>
      <td>${esc(x.entrypoint || x.kind)}</td><td>${uptime(x.startedAtMs)}</td>
      <td class="num" data-tip="in ${fmt(x.tokens.input)} · out ${fmt(x.tokens.output)}&#10;cache read ${fmt(x.tokens.cacheRead)} · write ${fmt(x.tokens.cacheWrite)}">${fmt(total(x.tokens))}</td>
      <td class="actions">${actions}</td></tr>`;
    })
    .join('');
  const recent = s.recentSessions
    .filter((r) => !r.live)
    .slice(0, 12)
    .map(
      (r) => `<li><button class="link" data-view="${esc(r.sessionId)}" data-name="${esc(r.project)} · ${esc(r.sessionId.slice(0, 8))}">${esc(r.project)} · ${esc(r.sessionId.slice(0, 8))}</button>
        <span class="sub">${ago(r.lastTsMs)}</span></li>`,
    )
    .join('');
  $('sessions').innerHTML = `<h2 id="h-sessions">Live sessions</h2>${
    rows
      ? `<div class="table-wrap"><table><thead><tr><th>Session</th><th>Project</th><th>Status</th><th>Branch</th><th>Source</th><th>Up</th><th class="num">Tokens</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : '<div class="empty">No live sessions.</div>'
  }${recent ? `<h3 class="h3">Recent sessions</h3><ul class="recent">${recent}</ul>` : ''}`;
}

function renderComms(s: DashboardState) {
  const sessionMsgs = s.messages.filter((m) => m.kind === 'session');
  const sub = s.messages.filter((m) => m.kind === 'subagent').length;

  // Graph: live sessions as nodes on a circle, plus nodes for peers that appear in messages.
  const names = new Set<string>(s.sessions.map((x) => x.name));
  const edges = new Map<string, number>();
  for (const m of sessionMsgs) {
    const a = m.direction === 'out' ? m.sessionName : m.peer;
    const b = m.direction === 'out' ? m.peer : m.sessionName;
    names.add(a);
    names.add(b);
    const k = `${a}\u0000${b}`;
    edges.set(k, (edges.get(k) ?? 0) + 1);
  }
  const nodes = [...names];
  const W = 420;
  const H = 260;
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(W, H) / 2 - 44;
  const pos = new Map(
    nodes.map((n, i) => {
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
      return [n, { x: nodes.length === 1 ? cx : cx + r * Math.cos(a), y: nodes.length === 1 ? cy : cy + r * Math.sin(a) }];
    }),
  );
  const live = new Set(s.sessions.map((x) => x.name));
  const edgeSvg = [...edges.entries()]
    .map(([k, n]) => {
      const [a, b] = k.split('\u0000');
      const p = pos.get(a)!;
      const q = pos.get(b)!;
      return `<line class="edge" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke-width="${Math.min(1 + n, 5)}" marker-end="url(#arrow)"/>
        <line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="transparent" stroke-width="14" data-tip="${esc(a)} → ${esc(b)}: ${n} message${n > 1 ? 's' : ''}"/>`;
    })
    .join('');
  const nodeSvg = nodes
    .map((n, i) => {
      const p = pos.get(n)!;
      const isLive = live.has(n);
      return `<g><circle cx="${p.x}" cy="${p.y}" r="9" style="fill:var(--s${(i % 8) + 1});stroke:var(--surface);stroke-width:2" opacity="${isLive ? 1 : 0.5}"/>
        <text class="node-label" x="${p.x}" y="${p.y + 24}" text-anchor="middle">${esc(n.length > 18 ? n.slice(0, 17) + '…' : n)}</text></g>`;
    })
    .join('');

  const feed = s.messages
    .slice(0, 40)
    .map(
      (m: MessageInfo) => `<li><div class="feed__meta">${m.direction === 'out' ? `${esc(m.sessionName)} → ${esc(m.peer)}` : `${esc(m.peer)} → ${esc(m.sessionName)}`}
        · ${m.kind === 'subagent' ? 'subagent hand-back' : 'session message'} · ${ago(m.tsMs)}</div><div>${esc(m.snippet)}</div></li>`,
    )
    .join('');

  $('comms').innerHTML = `<h2 id="h-comms">Session communication</h2>
    <div class="split"><div>
      ${
        sessionMsgs.length
          ? `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Message graph between sessions">
              <defs><marker id="arrow" viewBox="0 0 8 8" refX="14" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" style="fill:var(--muted)"/></marker></defs>
              ${edgeSvg}${nodeSvg}</svg>`
          : '<div class="empty">No session-to-session messages found yet.</div>'
      }
      <p class="sub">${sessionMsgs.length} session message${sessionMsgs.length === 1 ? '' : 's'} · ${sub} subagent hand-back${sub === 1 ? '' : 's'} (recent)</p>
    </div><ul class="feed">${feed || '<li class="empty">Nothing yet.</li>'}</ul></div>`;
}

const hidden = new Set<string>();

function renderUsage(s: DashboardState) {
  const days = s.usage.days.slice(-14);
  const projNames = s.projects.map((p) => p.name);
  const series = projNames.filter((n) => days.some((d) => (d.byProject[n] ?? 0) > 0));
  const other = (d: UsageDay) =>
    Object.entries(d.byProject)
      .filter(([k]) => !projNames.includes(k))
      .reduce((a, [, v]) => a + v, 0);

  const W = 720;
  const H = 240;
  const m = { l: 44, r: 8, t: 8, b: 24 };
  const visible = series.filter((n) => !hidden.has(n));
  const dayTotal = (d: UsageDay) => visible.reduce((a, n) => a + (d.byProject[n] ?? 0), 0) + (hidden.has('Other') ? 0 : other(d));
  const max = Math.max(1, ...days.map(dayTotal));
  const bw = (W - m.l - m.r) / Math.max(1, days.length);
  const y = (v: number) => m.t + (H - m.t - m.b) * (1 - v / max);

  const grid = [0, 0.5, 1]
    .map((f) => `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(max * f)}" y2="${y(max * f)}"/><text x="${m.l - 6}" y="${y(max * f) + 4}" text-anchor="end">${fmt(max * f)}</text>`)
    .join('');
  const bars = days
    .map((d, i) => {
      let acc = 0;
      const x = m.l + i * bw + bw * 0.15;
      const w = bw * 0.7;
      const segs = [...visible.map((n) => [n, d.byProject[n] ?? 0] as const), ...(hidden.has('Other') ? [] : [['Other', other(d)] as const])]
        .filter(([, v]) => v > 0)
        .map(([n, v]) => {
          const y1 = y(acc + v);
          const h = y(acc) - y1;
          acc += v;
          return `<rect x="${x}" y="${y1}" width="${w}" height="${Math.max(0, h - 2)}" rx="3" style="fill:${n === 'Other' ? 'var(--muted)' : colorOf(n)}" data-tip="${esc(d.day)}&#10;${esc(n)}: ${fmt(v)} tokens"/>`;
        })
        .join('');
      return `${segs}<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${d.day.slice(5)}</text>`;
    })
    .join('');

  const legend = [...series, ...(days.some((d) => other(d) > 0) ? ['Other'] : [])]
    .map(
      (n) =>
        `<button class="btn legend-btn" data-toggle="${esc(n)}" aria-pressed="${!hidden.has(n)}" style="opacity:${hidden.has(n) ? 0.45 : 1}"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;background:${n === 'Other' ? 'var(--muted)' : colorOf(n)}"></i>${esc(n)}</button>`,
    )
    .join(' ');

  const t = s.usage.totals;
  const modelRows = Object.entries(s.usage.byModel)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${fmt(v)}</td></tr>`)
    .join('');
  const tableRows = days
    .slice()
    .reverse()
    .map((d) => `<tr><td>${esc(d.day)}</td><td class="num">${fmt(d.tokens.input)}</td><td class="num">${fmt(d.tokens.output)}</td><td class="num">${fmt(d.tokens.cacheRead)}</td><td class="num">${fmt(d.tokens.cacheWrite)}</td></tr>`)
    .join('');

  $('usage').innerHTML = `<h2 id="h-usage">Token usage · last 14 days</h2>
    <div class="legend">${legend}</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily tokens stacked by project">${grid}<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>${bars}</svg>
    <div class="split" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Day</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cache read</th><th class="num">Cache write</th></tr></thead><tbody>${tableRows}</tbody>
      <tfoot><tr><th>All time</th><th class="num">${fmt(t.input)}</th><th class="num">${fmt(t.output)}</th><th class="num">${fmt(t.cacheRead)}</th><th class="num">${fmt(t.cacheWrite)}</th></tr></tfoot></table></div>
      <div class="table-wrap"><table><thead><tr><th>Model</th><th class="num">Tokens</th></tr></thead><tbody>${modelRows}</tbody></table></div></div>`;
}

document.addEventListener('click', (e) => {
  const b = (e.target as Element).closest('[data-toggle]');
  if (!b) return;
  const n = b.getAttribute('data-toggle')!;
  if (hidden.has(n)) hidden.delete(n);
  else hidden.add(n);
  if (last) renderUsage(last);
});

let last: DashboardState | null = null;
const warn = $('render-warn');
function render(s: DashboardState) {
  // A server started before the subagent feature doesn't send this field; don't let that break the whole page.
  s.subagents ??= [];
  last = s;
  // Each step runs on its own: one failing section must not freeze the others or later pushes.
  const steps: Array<[string, () => void]> = [
    ['colors', () => setColors(s.projects.map((p) => p.name))],
    ['limits', () => renderLimits(s)],
    ['team', () => renderTeam(s)],
    ['projects', () => renderProjects(s)],
    ['sessions', () => renderSessions(s)],
    ['messages', () => renderComms(s)],
    ['usage', () => renderUsage(s)],
    ['controls', () => updateControls(s)],
    ['building', () => updateBuilding(s, tintOf)],
    ['core', () => updateCore(s)],
  ];
  let failed = false;
  for (const [name, run] of steps) {
    try {
      run();
    } catch (err) {
      failed = true;
      console.error(`render step "${name}" failed`, err);
    }
  }
  // Fixed text only; the real error goes to the console. Clears itself on the next clean push.
  warn.hidden = !failed;
}

initControls();
initBuilding();
initCore();

// ---- skin + theme + transport ----

const root = document.documentElement;
const skinSelect = $<HTMLSelectElement>('skin');
const themeBtn = $<HTMLButtonElement>('theme');
function applySkin(skin: Skin) {
  if (skin === 'classic') root.removeAttribute('data-skin');
  else root.setAttribute('data-skin', skin);
  skinSelect.value = skin;
  // Co-pilot and Root are dark only, so the light/dark toggle has nothing to do there.
  themeBtn.hidden = skin === 'copilot' || skin === 'root';
  if (skin === 'root') ensureRootScene(); // builds the artwork once; other skins never load it
}
let savedSkin: string | null = null;
try {
  savedSkin = localStorage.getItem('skin');
} catch {
  // storage unavailable; use Classic
}
applySkin(parseSkin(savedSkin));
skinSelect.addEventListener('change', () => {
  const skin = parseSkin(skinSelect.value);
  applySkin(skin);
  try {
    localStorage.setItem('skin', skin);
  } catch {
    // ignore
  }
});

try {
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
} catch {
  // storage unavailable; follow OS
}
$('theme').addEventListener('click', () => {
  const dark = root.getAttribute('data-theme') === 'dark' || (!root.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = dark ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try {
    localStorage.setItem('theme', next);
  } catch {
    // ignore
  }
});

const conn = $('conn');
const ev = new EventSource('/api/events');
ev.onmessage = (m) => {
  conn.textContent = 'live';
  conn.classList.add('is-live');
  let state: DashboardState;
  try {
    const parsed: unknown = JSON.parse(m.data);
    if (typeof parsed !== 'object' || !parsed) throw new Error('state is not an object');
    state = parsed as DashboardState;
  } catch (err) {
    console.error('bad state push', err);
    warn.hidden = false;
    return;
  }
  render(state);
};
ev.onerror = () => {
  conn.textContent = 'reconnecting…';
  conn.classList.remove('is-live');
  // An expired login shows up as a failing stream; this redirects to /login on 401.
  api('/api/state').catch(() => {});
};
