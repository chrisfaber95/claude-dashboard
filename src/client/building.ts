import type { DashboardState, SessionInfo, SubagentInfo, TokenCounts } from '../shared/types/index.ts';
import { openSubagentTranscript, openTranscript } from './controls.ts';
import { moodOf, type SessionMood } from './mood.ts';
import { $, esc } from './util.ts';

// Room geometry (SVG units).
const RW = 210;
const RH = 130;
const GAP = 10;
const PAD = 14;
const ROOF = 74;
const BASE = 30;

// Subagent annex under a room: cubicles in rows of three, joined to the room by pipes.
const CW = 66;
const CG = 6;
const CH = 70;
const AH = 92;
const PER_ROW = 3;

// Skin and hair variants; the colours live in style.scss (.skin-N, .hair-N).
const SKINS = 4;
const HAIRS = 5;

let open: string | null = null;
let latest: DashboardState | null = null;
let tintClass: (name: string) => string = () => 'tint-1';
let drawnKey = '';

const total = (t: TokenCounts) => t.input + t.output + t.cacheRead + t.cacheWrite;
const fmt = (n: number) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
/** Tooltip text, one line per entry. It is shown with textContent; `tipAttr` escapes it for an HTML attribute. */
const tipText = (lines: (string | false)[]) => lines.filter(Boolean).join('\n');
const tipAttr = (text: string) => esc(text).replace(/\n/g, '&#10;');

function uptime(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

type Mood = SessionMood;
const isBackground = (s: SessionInfo) => s.kind === 'background' || s.kind === 'bg';

function statLine(s: SessionInfo): string {
  return `${fmt(total(s.tokens))} tokens · up ${uptime(s.startedAtMs)}`;
}

function roomTip(s: SessionInfo): string {
  return tipText([s.name,`${s.status}${isBackground(s) ? ' · background' : ''}${s.branch ? ` · ${s.branch}` : ''}`, statLine(s), 'Click to read the transcript']);
}

function subTip(a: SubagentInfo, byId: Map<string, SubagentInfo>): string {
  const from = a.parentAgentId ? `subagent ${byId.get(a.parentAgentId)?.agentType ?? a.parentAgentId.slice(0, 8)}` : 'the main session';
  const outcome =
    a.state === 'working'
      ? a.activity && `Now: ${a.activity}`
      : a.handedBack
        ? a.result
          ? `Handed back: ${a.result}`
          : 'Handed back (no report text recorded)'
        : 'No activity for 5 minutes and nothing handed back';
  return tipText([
    `${a.agentType} · ${a.state}${a.background ? ' · background' : ''}`,
    a.description,
    `Handed down by: ${from}`,
    a.prompt && `Brief: ${a.prompt}`,
    outcome,
    `${fmt(a.tokens)} tokens`,
    'Click to read what it did',
  ]);
}

function worker(i: number, mood: Mood, bg: boolean): string {
  const skin = i % SKINS;
  const hair = i % HAIRS;
  const shirt = (i % 8) + 1;
  const lines = [0, 1, 2, 3]
    .map((n) => `<rect class="room__code room__code--${n}" x="119" y="${65 + n * 5}" width="${[22, 30, 16, 26][n]}" height="2" rx="1"/>`)
    .join('');
  const mug =
    mood === 'busy'
      ? ''
      : `<g><rect class="room__mug" x="100" y="80" width="9" height="8" rx="2"/><path class="room__handle" d="M109 82h3v4h-3"/>
          <path class="room__steam" d="M103 77q-2-3 0-5"/></g>`;
  const dots = [0, 1, 2].map((n) => `<circle class="room__dot room__dot--${n}" cx="${95 + n * 6}" cy="34" r="2"/>`).join('');
  const bubble =
    mood === 'busy'
      ? `<g class="room__bubble"><rect class="room__bubble-bg" x="86" y="26" width="30" height="16" rx="8"/>${dots}</g>`
      : mood === 'waiting'
        ? `<g class="room__bubble room__bubble--ask"><rect class="room__bubble-bg room__bubble-bg--ask" x="86" y="26" width="30" height="16" rx="8"/><text class="room__ask" x="101" y="38" text-anchor="middle">?</text></g>`
        : `<g class="room__zzz"><text x="92" y="42">z</text><text x="100" y="34">z</text><text x="108" y="26">Z</text></g>`;
  const hat = bg
    ? `<path class="room__hat" d="M70 58a9 9 0 0 1 18 0z"/><rect class="room__brim" x="68" y="57" width="22" height="3" rx="1.5"/>`
    : `<path class="hair-${hair}" d="M70 59a9 9 0 0 1 18-1q-5-6-18 1z"/>`;
  return `
    <rect class="room__chair" x="58" y="70" width="5" height="28" rx="2"/>
    <rect class="room__chair" x="58" y="94" width="26" height="4" rx="2"/>
    <rect class="room__chair" x="69" y="98" width="3" height="14"/>
    <rect class="room__legs" x="76" y="94" width="26" height="7" rx="3"/><rect class="room__legs" x="96" y="94" width="7" height="18" rx="3"/>
    <rect class="shirt-${shirt}" x="70" y="70" width="18" height="26" rx="7"/>
    <g class="room__head"><circle class="skin-${skin}" cx="79" cy="60" r="9"/>${hat}<circle class="room__eye" cx="83" cy="60" r="1.2"/></g>
    <rect class="room__desk" x="70" y="87" width="104" height="6" rx="2"/>
    <rect class="room__desk" x="76" y="93" width="4" height="19"/><rect class="room__desk" x="164" y="93" width="4" height="19"/>
    <rect class="room__desk" x="118" y="85" width="12" height="3"/>
    <rect class="room__monitor" x="112" y="58" width="46" height="30" rx="3"/>
    <rect class="room__screen" x="115" y="61" width="40" height="24" rx="1.5"/>
    ${mood === 'busy' ? lines : ''}
    ${mug}
    <g class="room__arms"><path class="room__arm arm-skin-${skin}" d="M83 78L106 86"/>
      <path class="room__arm room__arm--b sleeve-${shirt}" d="M80 80L102 87"/></g>
    ${bubble}`;
}

function room(s: SessionInfo, i: number, x: number, y: number): string {
  const mood = moodOf(s);
  const bg = isBackground(s);
  return `<g class="room room--${mood}" transform="translate(${x} ${y})" data-tip="${tipAttr(roomTip(s))}" data-room="${esc(s.sessionId)}" data-name="${esc(s.name)}" tabindex="0" role="button" aria-label="${esc(`${s.name}, ${s.status}. Open transcript`)}">
    <rect class="room__wall" width="${RW}" height="${RH}" rx="4"/>
    <rect class="room__window" x="14" y="16" width="40" height="34" rx="2"/>
    <path class="room__pane" d="M34 16v34M14 33h40"/>
    <rect class="room__floor" y="112" width="${RW}" height="18"/>
    <rect class="room__pot" x="182" y="98" width="14" height="14" rx="2"/><circle class="room__leaf" cx="189" cy="92" r="9"/><circle class="room__leaf room__leaf--b" cx="184" cy="96" r="6"/>
    ${worker(i, mood, bg)}
    <text class="room__name" x="10" y="13">${esc(short(s.name, 20))}</text>
    <text class="room__state" x="${RW - 10}" y="13" text-anchor="end">${esc(s.status)}${bg ? ' · bg' : ''}</text>
    <text class="room__stat" x="10" y="125" data-stat="${esc(s.sessionId)}">${esc(statLine(s))}</text>
    <rect class="room__focus" width="${RW}" height="${RH}" rx="4"/>
  </g>`;
}

function emptyRoom(x: number, y: number): string {
  return `<g class="room room--empty" transform="translate(${x} ${y})">
    <rect class="room__wall" width="${RW}" height="${RH}" rx="4"/>
    <rect class="room__floor" y="112" width="${RW}" height="18"/>
    <rect class="room__window" x="14" y="16" width="40" height="34" rx="2"/>
    <rect class="room__desk" x="70" y="87" width="104" height="6" rx="2"/><rect class="room__desk" x="76" y="93" width="4" height="19"/><rect class="room__desk" x="164" y="93" width="4" height="19"/>
    <rect class="room__monitor" x="112" y="58" width="46" height="30" rx="3"/><rect class="room__screen room__screen--off" x="115" y="61" width="40" height="24" rx="1.5"/>
    <text class="room__name" x="10" y="13">Nobody here</text>
    <text class="room__state" x="${RW - 10}" y="13" text-anchor="end">lights off</text>
  </g>`;
}

const hueOf = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 8) + 1;
};

const annexRows = (n: number) => Math.ceil(n / PER_ROW);

const cubeLabel = (a: SubagentInfo) => short(a.state === 'working' ? a.activity || 'working…' : a.handedBack ? 'handed back' : 'quiet', 15);

/** One subagent at its desk: a small robot that types while it works and shows a tick once it has handed back. */
function cubicle(a: SubagentInfo, x: number, y: number, byId: Map<string, SubagentInfo>): string {
  const working = a.state === 'working';
  const color = hueOf(a.agentType);
  const code = [0, 1, 2]
    .map((n) => `<rect class="room__code room__code--${n}" x="40" y="${30 + n * 3.5}" width="${[8, 11, 6][n]}" height="1.4" rx="0.7"/>`)
    .join('');
  return `<g class="annex__cube annex__cube--${a.state}${a.parentAgentId ? ' annex__cube--child' : ''}" transform="translate(${x} ${y})" data-tip="${tipAttr(subTip(a, byId))}" data-sub="${esc(a.agentId)}" data-name="${esc(`${a.agentType}: ${a.description || a.agentId}`)}" tabindex="0" role="button" aria-label="${esc(`${a.agentType}, ${a.state}. Open what it did`)}">
    <rect class="annex__wall" width="${CW}" height="${CH}" rx="4"/>
    <text class="annex__type" x="4" y="10">${esc(short(a.agentType, 11))}</text>
    <circle class="annex__dot annex__dot--${working ? 'working' : a.handedBack ? 'done' : 'quiet'}" cx="${CW - 6}" cy="7" r="4"/>
    ${a.handedBack && !working ? `<path class="annex__tick" d="M${CW - 8.6} 7l1.9 1.9 3.4-3.8"/>` : ''}
    <rect class="annex__desk" x="22" y="46" width="40" height="4" rx="1"/><rect class="annex__desk" x="25" y="50" width="3" height="8"/><rect class="annex__desk" x="56" y="50" width="3" height="8"/>
    <rect class="room__monitor" x="36" y="26" width="22" height="16" rx="2"/><rect class="room__screen${working ? '' : ' room__screen--off'}" x="38" y="28" width="18" height="12" rx="1"/>
    <rect class="annex__desk" x="45" y="42" width="4" height="4"/>
    ${working ? code : ''}
    <line class="annex__antenna" x1="17" y1="16" x2="17" y2="19"/><circle class="shirt-${color}" cx="17" cy="15" r="2"/>
    <rect class="annex__head" x="11" y="19" width="12" height="11" rx="3"/>
    <circle class="annex__eye" cx="15" cy="24" r="1.3"/><circle class="annex__eye" cx="20" cy="24" r="1.3"/>
    <rect class="shirt-${color}" x="10" y="31" width="14" height="15" rx="3"/>
    <rect class="annex__arm shirt-${color}" x="22" y="39" width="15" height="3.2" rx="1.6"/>
    <text class="annex__activity" x="4" y="${CH - 4}" data-act="${esc(a.agentId)}">${esc(cubeLabel(a))}</text>
  </g>`;
}

/** The subagents of one session, in the space under its room (local coordinates start at the room's top-left). */
function annex(subs: SubagentInfo[], byId: Map<string, SubagentInfo>): string {
  const pos = new Map(
    subs.map((a, i) => {
      const row = Math.floor(i / PER_ROW);
      return [a.agentId, { x: (i % PER_ROW) * (CW + CG), y: RH + row * AH + 18, bus: RH + row * AH + 6, row }] as const;
    }),
  );
  const nested = (a: SubagentInfo) => Boolean(a.parentAgentId && pos.has(a.parentAgentId));
  const fromMain = subs.filter((a) => !nested(a));

  // Pipes: from the room down a trunk to a bus per row, with a stub into each cubicle the main session handed work to.
  const busRows = [...new Set(fromMain.map((a) => pos.get(a.agentId)!.row))];
  let pipes = '';
  if (busRows.length) {
    const lastBus = RH + Math.max(...busRows) * AH + 6;
    pipes += `<path class="annex__pipe" d="M0 ${RH - 6}H-5V${lastBus}"/>`;
    for (const r of busRows) {
      const mine = fromMain.filter((a) => pos.get(a.agentId)!.row === r).map((a) => pos.get(a.agentId)!);
      const bus = RH + r * AH + 6;
      pipes += `<path class="annex__pipe" d="M-5 ${bus}H${Math.max(...mine.map((p) => p.x + CW / 2))}${mine.map((p) => `M${p.x + CW / 2} ${bus}V${p.y}`).join('')}"/>`;
    }
  }
  // A subagent started by another subagent hangs off its parent's cubicle with a dashed pipe.
  for (const a of subs.filter(nested)) {
    const p = pos.get(a.parentAgentId!)!;
    const c = pos.get(a.agentId)!;
    const d =
      p.row === c.row
        ? `M${p.x + CW} ${p.y + CH / 2}H${c.x}`
        : `M${p.x + CW / 2} ${p.y + CH}V${c.bus}H${c.x + CW / 2}V${c.y}`;
    pipes += `<path class="annex__pipe annex__pipe--nested" d="${d}"/>`;
  }
  // Envelopes ride down the stub while the work is being handed over.
  const mail = fromMain
    .filter((a) => a.state === 'working')
    .map((a) => {
      const p = pos.get(a.agentId)!;
      return `<g transform="translate(${p.x + CW / 2} ${p.bus})"><g class="annex__mail annex__mail--c${(p.x / (CW + CG)) | 0}"><rect x="-4" y="-3" width="8" height="6" rx="1"/><path d="M-4 -3l4 3 4-3"/></g></g>`;
    })
    .join('');
  const cubes = subs.map((a) => cubicle(a, pos.get(a.agentId)!.x, pos.get(a.agentId)!.y, byId)).join('');
  return `${pipes}${mail}${cubes}`;
}

function scene(name: string, sessions: SessionInfo[], subagents: SubagentInfo[]): string {
  const n = sessions.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(n / cols));
  const W = PAD * 2 + cols * RW + (cols - 1) * GAP;
  const label = short(name, 26);
  const byId = new Map(subagents.map((a) => [a.agentId, a]));
  const subsOf = (s: SessionInfo) => subagents.filter((a) => a.sessionId === s.sessionId);

  // A floor is as tall as its tallest room plus that room's annex.
  const floorH = Array.from({ length: rows }, (_, r) => {
    const here = sessions.slice(r * cols, r * cols + cols);
    return RH + Math.max(0, ...here.map((s) => annexRows(subsOf(s).length) * AH));
  });
  // First sessions get the ground floor (row 0, at the bottom); later ones stack on top.
  const floorY = new Map<number, number>();
  let y = ROOF + GAP;
  for (let r = rows - 1; r >= 0; r--) {
    floorY.set(r, y);
    y += floorH[r] + GAP;
  }
  const roomsBottom = y - GAP;
  const H = roomsBottom + GAP + BASE;

  let cells = '';
  for (let k = 0; k < Math.max(1, n); k++) {
    const x = PAD + (k % cols) * (RW + GAP);
    const fy = floorY.get(Math.floor(k / cols))!;
    if (!n) {
      cells += emptyRoom(x, fy);
      continue;
    }
    cells += room(sessions[k], k, x, fy);
    const subs = subsOf(sessions[k]);
    if (subs.length) cells += `<g class="annex" transform="translate(${x} ${fy})">${annex(subs, byId)}</g>`;
  }
  const doorX = W / 2 - 16;

  return `<svg class="building__svg building__svg--cols-${cols}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(name)} building with ${n} session${n === 1 ? '' : 's'} and ${subagents.length} subagent${subagents.length === 1 ? '' : 's'}">
    <g class="building__clouds"><ellipse class="cloud" cx="40" cy="30" rx="26" ry="9"/><ellipse class="cloud cloud--b" cx="${W - 60}" cy="52" rx="32" ry="10"/></g>
    <rect class="building__antenna" x="${W / 2 - 1.5}" y="2" width="3" height="22"/><circle class="building__beacon" cx="${W / 2}" cy="3" r="3.5"/>
    <rect class="building__sign ${tintClass(name)}" x="${PAD}" y="22" width="${W - PAD * 2}" height="${ROOF - 22}" rx="6"/>
    <text class="building__title" x="${W / 2}" y="${22 + (ROOF - 22) / 2 + 6}" text-anchor="middle">${esc(label)}</text>
    <rect class="building__body" x="2" y="${ROOF - 2}" width="${W - 4}" height="${roomsBottom - ROOF + GAP + 4}" rx="3"/>
    ${cells}
    <rect class="building__base" x="0" y="${roomsBottom + GAP}" width="${W}" height="${BASE}"/>
    <rect class="building__door" x="${doorX}" y="${roomsBottom + GAP + 4}" width="32" height="${BASE - 4}" rx="3"/>
    <circle class="building__knob" cx="${doorX + 25}" cy="${roomsBottom + GAP + 18}" r="1.8"/>
  </svg>`;
}

function render(force: boolean) {
  if (!open || !latest) return;
  const name = open;
  const project = latest.projects.find((p) => p.name === name);
  if (!project) {
    close();
    return;
  }
  const sessions = latest.sessions.filter((s) => s.project === name).sort((a, b) => a.startedAtMs - b.startedAtMs);
  const ids = new Set(sessions.map((s) => s.sessionId));
  const subagents = latest.subagents.filter((a) => ids.has(a.sessionId));
  const working = sessions.filter((s) => moodOf(s) === 'busy').length;
  const waiting = sessions.filter((s) => moodOf(s) === 'waiting').length;
  const subWorking = subagents.filter((a) => a.state === 'working').length;

  $('building-title').textContent = name;
  $('building-sub').textContent = sessions.length
    ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} in the building · ${working} working${waiting ? ` · ${waiting} waiting for you` : ''}${
        subagents.length ? ` · ${subagents.length} subagent${subagents.length === 1 ? '' : 's'} (${subWorking} working)` : ''
      }${project.branch ? ` · ${project.branch}` : ''}`
    : 'No live sessions: the building is empty.';

  // Re-draw only when something visible changed, so the animations aren't restarted every push.
  const key = [
    name,
    tintClass(name),
    ...sessions.map((s) => `${s.sessionId}:${s.name}:${s.status}:${s.kind}:${s.branch}`),
    ...subagents.map((a) => `${a.agentId}:${a.state}:${a.handedBack}:${a.parentAgentId}:${a.agentType}:${a.description}:${a.background}`),
  ].join('|');
  const body = $('building-body');
  if (force || key !== drawnKey) {
    body.innerHTML = scene(name, sessions, subagents);
    drawnKey = key;
    return;
  }
  // Same picture: only refresh the changing text and tooltips.
  const byId = new Map(subagents.map((a) => [a.agentId, a]));
  for (const s of sessions) {
    const id = CSS.escape(s.sessionId);
    const stat = body.querySelector(`[data-stat="${id}"]`);
    if (stat) stat.textContent = statLine(s);
    body.querySelector(`[data-room="${id}"]`)?.setAttribute('data-tip', roomTip(s));
  }
  for (const a of subagents) {
    const id = CSS.escape(a.agentId);
    const act = body.querySelector(`[data-act="${id}"]`);
    if (act) act.textContent = cubeLabel(a);
    body.querySelector(`[data-sub="${id}"]`)?.setAttribute('data-tip', subTip(a, byId));
  }
}

function close() {
  const name = open;
  open = null;
  drawnKey = '';
  $('building').hidden = true;
  // Hand keyboard focus back to the card that opened the building.
  if (name) document.querySelector<HTMLElement>(`[data-building="${CSS.escape(name)}"]`)?.focus();
}

export function openBuilding(name: string) {
  open = name;
  $('building').hidden = false;
  render(true);
  $('building-close').focus();
}

/** Called on every state push: keeps an open building in step with the live sessions. */
export function updateBuilding(s: DashboardState, tint: (name: string) => string) {
  latest = s;
  tintClass = tint;
  render(false);
}

/** A click or Enter on a room opens the session's transcript; on a cubicle, the subagent's. */
function activate(target: Element): boolean {
  const sub = target.closest<SVGElement>('[data-sub]');
  if (sub) {
    openSubagentTranscript(sub.dataset.sub!, sub.dataset.name ?? sub.dataset.sub!);
    return true;
  }
  const r = target.closest<SVGElement>('[data-room]');
  if (r) {
    openTranscript(r.dataset.room!, r.dataset.name ?? r.dataset.room!);
    return true;
  }
  return false;
}

export function initBuilding() {
  $('building-close').addEventListener('click', close);
  $('building').addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.id === 'building') close();
    else activate(t);
  });
  $('building').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (activate(e.target as Element)) e.preventDefault();
  });
  // Capture phase: runs before the transcript drawer's handler, so Escape closes the drawer first and the building second.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && open && $('drawer').hidden) close();
    },
    true,
  );
  document.addEventListener('click', (e) => {
    const c = (e.target as Element).closest<HTMLElement>('[data-building]');
    if (c) openBuilding(c.dataset.building!);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const c = (e.target as Element).closest<HTMLElement>('[data-building]');
    if (!c || c !== e.target) return;
    e.preventDefault();
    openBuilding(c.dataset.building!);
  });
}
