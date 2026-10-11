import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import TranscriptDrawer from '../../../../src/client/features/controls/transcript-drawer.vue';
import {
  closeDrawer,
  openLogs,
  openSubagentTranscript,
  openTranscript,
} from '../../../../src/client/features/controls/transcript-drawer-selection.ts';
import type { DashboardState, SessionInfo, TranscriptEntry } from '../../../../src/shared/types/index.ts';

const POLL_INTERVAL_MS = 2000;

function makeEntry(uuid: string, text = uuid): TranscriptEntry {
  return { uuid, tsMs: 0, role: 'assistant', text };
}

function makeSession(sessionId: string, kind: SessionInfo['kind']): SessionInfo {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return { sessionId, pid: 1, name: sessionId, project: 'Alpha', cwd: '/p/Alpha', status: 'busy', entrypoint: 'cli', kind, startedAtMs: 1, updatedAtMs: 1, branch: null, tokens };
}

function makeState(sessions: SessionInfo[] = [], commands = true): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions,
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands, permissionModes: ['plan', 'default', 'acceptEdits', 'auto'], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

interface FetchCall {
  path: string;
  body: unknown;
}

let calls: FetchCall[] = [];
let respond: (path: string) => unknown = () => ({ entries: [], hasMore: false });
let wrapper: VueWrapper;

function drawer(): HTMLElement {
  const element = document.getElementById('drawer');
  if (!element) throw new Error('drawer not mounted');
  return element;
}

async function settle(): Promise<void> {
  await flushPromises();
  await flushPromises();
}

function messageTexts(): string[] {
  return [...document.querySelectorAll('#drawer-body .msg__text')].map((node) => node.textContent ?? '');
}

beforeEach(() => {
  calls = [];
  respond = () => ({ entries: [], hasMore: false });
  vi.useFakeTimers();
  vi.stubGlobal('fetch', async (path: string, init?: { body?: string }) => {
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: true, status: 200, json: async () => respond(path) };
  });
  setDashboardState(makeState());
  wrapper = mount(TranscriptDrawer, { attachTo: document.body });
});

afterEach(() => {
  closeDrawer();
  wrapper.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('TranscriptDrawer', () => {
  it('is hidden until a transcript is opened, then shows its title and entries', async () => {
    expect(drawer().hidden).toBe(true);
    respond = () => ({ entries: [makeEntry('a', 'first <b>bold</b>'), makeEntry('b', 'second')], hasMore: false });
    openTranscript('s-1', 'Alpha work');
    await settle();
    expect(drawer().hidden).toBe(false);
    expect(document.getElementById('drawer-title')?.textContent).toBe('Alpha work');
    expect(document.getElementById('drawer-sub')?.textContent).toBe('Session s-1');
    expect(calls[0].path).toBe('/api/sessions/s-1/transcript?limit=100');
    expect(messageTexts()).toEqual(['first <b>bold</b>', 'second']);
    expect(document.querySelector('#drawer-body b')).toBeNull();
  });

  it('loads a subagent transcript from the subagent endpoint', async () => {
    openSubagentTranscript('ag-1', 'Helper');
    await settle();
    expect(calls[0].path).toBe('/api/subagents/ag-1/transcript?limit=100');
    expect(document.getElementById('drawer-sub')?.textContent).toBe('Subagent ag-1');
  });

  it('shows the terminal output of a background session', async () => {
    respond = () => ({ ok: true, output: 'line one\nline two' });
    await openLogs('bg-1', 'Builder');
    await settle();
    expect(calls[0].path).toBe('/api/sessions/bg-1/logs');
    expect(document.getElementById('drawer-title')?.textContent).toBe('Builder logs');
    expect(document.querySelector('#drawer-body pre.logs')?.textContent).toBe('line one\nline two');
  });

  it('loads earlier entries in front of the ones shown', async () => {
    respond = (path) => (path.includes('before=') ? { entries: [makeEntry('a')], hasMore: false } : { entries: [makeEntry('b'), makeEntry('c')], hasMore: true });
    openTranscript('s-1', 'Alpha');
    await settle();
    const more = document.querySelector<HTMLButtonElement>('[data-more]');
    expect(more?.textContent).toBe('Load earlier');
    more?.click();
    await settle();
    expect(calls[1].path).toBe('/api/sessions/s-1/transcript?limit=100&before=b');
    expect(messageTexts()).toEqual(['a', 'b', 'c']);
    expect(document.querySelector('[data-more]')).toBeNull();
  });

  it('adds new entries on a poll and keeps the scroll position of a reader who is not at the bottom', async () => {
    respond = () => ({ entries: [makeEntry('a'), makeEntry('b')], hasMore: false });
    openTranscript('s-1', 'Alpha');
    await settle();
    const body = document.getElementById('drawer-body');
    if (!body) throw new Error('no body');
    // happy-dom has no layout: pretend the reader scrolled up from the bottom.
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 100 });
    body.scrollTop = 200;
    respond = () => ({ entries: [makeEntry('a'), makeEntry('b'), makeEntry('c')], hasMore: false });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await settle();
    expect(messageTexts()).toEqual(['a', 'b', 'c']);
    expect(body.scrollTop).toBe(200);
  });

  it('recovers from a failed first load on the next poll', async () => {
    respond = () => {
      throw new Error('boom');
    };
    openTranscript('s-1', 'Alpha');
    await settle();
    expect(document.querySelector('#drawer-body .empty')).not.toBeNull();
    expect(messageTexts()).toEqual([]);
    respond = () => ({ entries: [makeEntry('a')], hasMore: false });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await settle();
    expect(document.querySelector('#drawer-body .empty')).toBeNull();
    expect(messageTexts()).toEqual(['a']);
  });

  it('closes with the Close button and with Escape, and stops polling', async () => {
    openTranscript('s-1', 'Alpha');
    await settle();
    document.getElementById('drawer-close')?.click();
    await settle();
    expect(drawer().hidden).toBe(true);
    const callCount = calls.length;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    expect(calls.length).toBe(callCount);

    openTranscript('s-2', 'Beta');
    await settle();
    expect(drawer().hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(drawer().hidden).toBe(true);
  });

  it('shows the follow-up form for a dashboard session and sends the prompt', async () => {
    openTranscript('s-1', 'Alpha');
    await settle();
    const form = document.getElementById('drawer-form');
    expect(form?.hidden).toBe(false);
    expect([...document.querySelectorAll('#drawer-mode option')].map((option) => option.textContent)).toEqual(['plan', 'default', 'acceptEdits', 'auto']);
    respond = () => ({ ok: true, id: 'bg-9', output: 'queued' });
    const textarea = document.querySelector<HTMLTextAreaElement>('#drawer-prompt');
    if (!textarea) throw new Error('no textarea');
    textarea.value = 'carry on';
    textarea.dispatchEvent(new Event('input'));
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    const send = calls.find((call) => call.path === '/api/sessions/s-1/message');
    expect(send?.body).toEqual({ prompt: 'carry on', permissionMode: 'auto' });
    expect(document.getElementById('drawer-status')?.textContent).toContain('queued');
    expect(textarea.value).toBe('');
  });

  it('shows a note instead of the form when the session lives in a terminal, and tracks pushes', async () => {
    setDashboardState(makeState([makeSession('s-1', 'interactive')]));
    openTranscript('s-1', 'Alpha');
    await settle();
    expect(document.getElementById('drawer-form')?.hidden).toBe(true);
    expect(document.getElementById('drawer-live-note')?.hidden).toBe(false);
    setDashboardState(makeState([makeSession('s-1', 'bg')]));
    await settle();
    expect(document.getElementById('drawer-form')?.hidden).toBe(false);
    expect(document.getElementById('drawer-live-note')?.hidden).toBe(true);
  });

  it('hides the form when commands are off', async () => {
    setDashboardState(makeState([], false));
    openTranscript('s-1', 'Alpha');
    await settle();
    expect(document.getElementById('drawer-form')?.hidden).toBe(true);
  });
});
