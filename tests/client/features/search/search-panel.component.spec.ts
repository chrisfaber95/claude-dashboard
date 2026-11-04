import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import SearchPanel from '../../../../src/client/features/search/search-panel.vue';
import type { DashboardState, SearchAnswer, SearchResult } from '../../../../src/shared/types/index.ts';

function makeState(): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [{ name: 'demo', path: 'N:/Projects/demo', branch: null, isWorktree: false, lastActiveMs: null, liveSessions: 0, trusted: true, tokensToday: 0, tokens7d: 0, tokensTotal: 0 }],
    sessions: [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands: false, permissionModes: [], manageDevices: false, search: true },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

const RESULT: SearchResult = { source: 'wiki/page', location: 'Intro', date: '2026-01-02', project: 'demo', sourceType: 'wiki', snippet: 'a snippet', url: '' };
const ANSWER: SearchAnswer = { answer: 'The answer', citations: [{ source: 'wiki/page', location: 'Intro', url: 'https://example.com/x' }], requestId: 'req-1', backend: 'local' };

interface Reply {
  status?: number;
  body: unknown;
}

type Handler = (path: string, body: unknown) => Reply | Promise<Reply>;

function mockFetch(handler: Handler): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (path: string, init: { body?: string }) => {
    const reply = await handler(path, init.body ? JSON.parse(init.body) : undefined);
    const status = reply.status ?? 200;
    return { ok: status < 400, status, json: async () => reply.body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function route(ask: Reply, query: Reply = { body: { results: [RESULT] } }): Handler {
  return (path) => {
    if (path === '/api/search/ask') return ask;
    if (path === '/api/search/query') return query;
    return { body: { ok: true } };
  };
}

async function search(wrapper: VueWrapper, text = 'what is x'): Promise<void> {
  await wrapper.get('#search-input').setValue(text);
  await wrapper.get('#search-form').trigger('submit');
  await flushPromises();
}

function bodiesFor(fetchMock: ReturnType<typeof vi.fn>, path: string): unknown[] {
  return fetchMock.mock.calls.filter((call) => call[0] === path).map((call) => JSON.parse(call[1].body));
}

function button(wrapper: VueWrapper, label: string): ReturnType<VueWrapper['get']> {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === label);
  if (!found) throw new Error(`no ${label} button`);
  return found;
}

describe('SearchPanel', () => {
  beforeEach(() => setDashboardState(makeState()));
  afterEach(() => vi.unstubAllGlobals());

  it('offers the projects and source types as filters', () => {
    const wrapper = mount(SearchPanel);

    expect(wrapper.findAll('#search-project option').map((option) => option.text())).toEqual(['All projects', 'demo']);
    expect(wrapper.findAll('#search-source option')[0]?.text()).toBe('All sources');
    expect(wrapper.findAll('#search-source option').length).toBe(7);
  });

  it('shows the answer, citations and results from the three paths only', async () => {
    const fetchMock = mockFetch(route({ body: ANSWER }));
    const wrapper = mount(SearchPanel);

    await search(wrapper);

    expect(wrapper.get('.search__text').text()).toBe('The answer');
    expect(wrapper.get('.search__citations a').attributes()).toMatchObject({ href: 'https://example.com/x', target: '_blank', rel: 'noopener noreferrer' });
    expect(wrapper.get('.search__snippet').text()).toBe('a snippet');
    expect(wrapper.get('.search__meta').text()).toContain('2026-01-02');
    expect(fetchMock.mock.calls.map((call) => call[0]).sort()).toEqual(['/api/search/ask', '/api/search/query']);
  });

  it('renders an HTML answer as text, never as an element', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    mockFetch(route({ body: { ...ANSWER, answer: hostile } }, { body: { results: [{ ...RESULT, snippet: hostile }] } }));
    const wrapper = mount(SearchPanel);

    await search(wrapper);

    expect(wrapper.get('.search__text').text()).toBe(hostile);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('renders a javascript: citation and result url as plain text', async () => {
    const bad = { source: 'evil', location: 'x', url: 'javascript:alert(1)' };
    mockFetch(route({ body: { ...ANSWER, citations: [bad] } }, { body: { results: [{ ...RESULT, url: 'data:text/html,x' }] } }));
    const wrapper = mount(SearchPanel);

    await search(wrapper);

    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.get('.search__citations').text()).toBe('evil / x');
  });

  it('sends hard:true to ask only when the toggle is on, and the filters', async () => {
    const fetchMock = mockFetch(route({ body: ANSWER }));
    const wrapper = mount(SearchPanel);
    await wrapper.get('#search-hard').setValue(true);
    await wrapper.get('#search-project').setValue('demo');
    await wrapper.get('#search-source').setValue('wiki');

    await search(wrapper);

    expect(bodiesFor(fetchMock, '/api/search/ask')).toEqual([{ question: 'what is x', project: 'demo', sourceType: 'wiki', hard: true }]);
    expect(bodiesFor(fetchMock, '/api/search/query')).toEqual([{ question: 'what is x', project: 'demo', sourceType: 'wiki' }]);
  });

  it('shows one unreachable state when both calls fail, with the server message', async () => {
    mockFetch(route({ status: 502, body: { error: 'search service unreachable' } }, { status: 502, body: { error: 'search service unreachable' } }));
    const wrapper = mount(SearchPanel);

    await search(wrapper);

    const alerts = wrapper.findAll('[role="alert"]');
    expect(alerts.length).toBe(1);
    expect(alerts[0]?.text()).toContain('Search service unreachable');
    expect(alerts[0]?.text()).toContain('search service unreachable');
  });

  it('shows a per-part error with Retry when only the ask fails', async () => {
    let askCalls = 0;
    const fetchMock = mockFetch((path) => {
      if (path === '/api/search/query') return { body: { results: [RESULT] } };
      askCalls += 1;
      return askCalls === 1 ? { status: 503, body: { error: 'search is not configured' } } : { body: ANSWER };
    });
    const wrapper = mount(SearchPanel);

    await search(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toContain('search is not configured');
    expect(wrapper.find('.search__result').exists()).toBe(true);

    await button(wrapper, 'Retry').trigger('click');
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('.search__text').text()).toBe('The answer');
    expect(bodiesFor(fetchMock, '/api/search/query').length).toBe(1);
  });

  it('shows the empty state for zero results', async () => {
    mockFetch(route({ body: { ...ANSWER, citations: [] } }, { body: { results: [] } }));
    const wrapper = mount(SearchPanel);

    await search(wrapper);

    expect(wrapper.text()).toContain('Nothing found.');
  });

  it('posts the thumbs-down requestId once, then disables the button', async () => {
    const fetchMock = mockFetch(route({ body: ANSWER }));
    const wrapper = mount(SearchPanel);
    await search(wrapper);

    const thumbs = button(wrapper, 'Thumbs down');
    await thumbs.trigger('click');
    await flushPromises();
    await thumbs.trigger('click');
    await flushPromises();

    expect(bodiesFor(fetchMock, '/api/search/feedback')).toEqual([{ requestId: 'req-1' }]);
    expect(wrapper.text()).toContain('Thanks, noted');
    expect(thumbs.attributes('disabled')).toBeDefined();
  });

  it('hides the thumbs-down without a requestId and resets it on a new answer', async () => {
    mockFetch(route({ body: { ...ANSWER, requestId: '' } }));
    const wrapper = mount(SearchPanel);
    await search(wrapper);
    expect(wrapper.text()).not.toContain('Thumbs down');

    mockFetch(route({ body: ANSWER }));
    await search(wrapper);
    await button(wrapper, 'Thumbs down').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Thanks, noted');

    await search(wrapper, 'again');
    expect(wrapper.text()).not.toContain('Thanks, noted');
    expect(button(wrapper, 'Thumbs down').attributes('disabled')).toBeUndefined();
  });

  it('ignores a stale response when the user searches again', async () => {
    const releases: Array<() => void> = [];
    mockFetch(async (path, body) => {
      const question = typeof body === 'object' && body !== null && 'question' in body ? String(body.question) : '';
      if (question === 'first') await new Promise<void>((resolve) => releases.push(resolve));
      if (path === '/api/search/ask') return { body: { ...ANSWER, answer: `answer to ${question}` } };
      return { body: { results: [{ ...RESULT, snippet: `snippet for ${question}` }] } };
    });
    const wrapper = mount(SearchPanel);

    await wrapper.get('#search-input').setValue('first');
    await wrapper.get('#search-form').trigger('submit');
    await wrapper.get('#search-input').setValue('second');
    await wrapper.get('#search-form').trigger('submit');
    await flushPromises();
    releases.forEach((release) => release());
    await flushPromises();

    expect(wrapper.get('.search__text').text()).toBe('answer to second');
    expect(wrapper.get('.search__snippet').text()).toBe('snippet for second');
  });
});
