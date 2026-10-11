import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import BuildingScene from '../../../../src/client/features/building/building-scene.vue';
import { setOpenBuilding } from '../../../../src/client/features/building/building-selection.ts';
import type { DashboardState, SessionInfo, SubagentInfo } from '../../../../src/shared/types/index.ts';

function makeSession(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: id,
    pid: 1,
    name: `Session ${id}`,
    project: 'demo',
    cwd: 'N:/Projects/demo',
    status: 'busy',
    entrypoint: 'cli',
    kind: 'interactive',
    startedAtMs: 1000,
    updatedAtMs: 2000,
    branch: 'main',
    tokens: { input: 1500, output: 500, cacheRead: 0, cacheWrite: 0 },
    ...overrides,
  };
}

function makeSubagent(id: string, sessionId: string, overrides: Partial<SubagentInfo> = {}): SubagentInfo {
  return {
    agentId: id,
    sessionId,
    project: 'demo',
    agentType: 'Explore',
    description: 'look around',
    prompt: 'find things',
    background: false,
    parentAgentId: null,
    startedAtMs: 1,
    lastTsMs: 2,
    state: 'working',
    handedBack: false,
    activity: 'Read: a.ts',
    result: '',
    tokens: 10,
    ...overrides,
  };
}

function makeState(sessions: SessionInfo[], subagents: SubagentInfo[]): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions,
    subagents,
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands: false, permissionModes: [], manageDevices: false },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

function openDemo(sessions: SessionInfo[], subagents: SubagentInfo[] = []): ReturnType<typeof mount> {
  setDashboardState(makeState(sessions, subagents));
  setOpenBuilding({ name: 'demo', tintClass: 'tint-3' });
  return mount(BuildingScene);
}

describe('BuildingScene', () => {
  afterEach(() => setOpenBuilding(null));

  it('draws nothing while no building is open', () => {
    setDashboardState(makeState([makeSession('s1')], []));
    const wrapper = mount(BuildingScene);
    expect(wrapper.find('svg').exists()).toBe(false);
  });

  it('draws the sign, one room per session and the door for a project with one session', () => {
    const wrapper = openDemo([makeSession('s1')]);

    const svg = wrapper.get('svg');
    expect(svg.classes()).toEqual(['building__svg', 'building__svg--cols-1']);
    expect(svg.attributes('aria-label')).toBe('demo building with 1 session and 0 subagents');
    expect(wrapper.get('.building__sign').classes()).toContain('tint-3');
    expect(wrapper.get('.building__title').text()).toBe('demo');
    const room = wrapper.get('[data-room="s1"]');
    expect(room.classes()).toEqual(['room', 'room--busy']);
    expect(room.attributes('data-name')).toBe('Session s1');
    expect(room.attributes('aria-label')).toBe('Session s1, busy. Open transcript');
    expect(room.attributes('data-tip')).toContain('Click to read the transcript');
    expect(room.get('.room__stat').text()).toMatch(/^2\.0k tokens · up (\d+h )?\d+m$/);
    expect(room.get('.room__state').text()).toBe('busy');
    expect(wrapper.find('.annex').exists()).toBe(false);
    expect(wrapper.find('.building__door').exists()).toBe(true);
  });

  it('shows the hard hat and "bg" for a background session, and the mood of its status', () => {
    const wrapper = openDemo([makeSession('s1', { kind: 'bg', status: 'waiting' }), makeSession('s2', { status: 'idle', startedAtMs: 2000 })]);

    const [first, second] = wrapper.findAll('.room');
    expect(first?.classes()).toContain('room--waiting');
    expect(first?.find('.room__bubble--ask').exists()).toBe(true);
    expect(first?.find('.room__hat').exists()).toBe(true);
    expect(first?.get('.room__state').text()).toBe('waiting · bg');
    expect(second?.classes()).toContain('room--idle');
    expect(second?.find('.room__zzz').exists()).toBe(true);
    expect(second?.find('.room__hat').exists()).toBe(false);
    expect(wrapper.get('svg').classes()).toContain('building__svg--cols-2');
  });

  it('renders the dark room for a project without live sessions', () => {
    const wrapper = openDemo([]);

    expect(wrapper.findAll('.room')).toHaveLength(1);
    expect(wrapper.get('.room').classes()).toEqual(['room', 'room--empty']);
    expect(wrapper.get('.room__name').text()).toBe('Nobody here');
    expect(wrapper.get('.room__state').text()).toBe('lights off');
    expect(wrapper.find('[data-room]').exists()).toBe(false);
    expect(wrapper.get('svg').attributes('aria-label')).toBe('demo building with 0 sessions and 0 subagents');
  });

  it('puts the subagents of a session in an annex with pipes, mail and a tick for a handed-back one', () => {
    const wrapper = openDemo(
      [makeSession('s1'), makeSession('other', { project: 'elsewhere' })],
      [
        makeSubagent('a1', 's1'),
        makeSubagent('a2', 's1', { state: 'done', handedBack: true, parentAgentId: 'a1', activity: '', result: 'ok' }),
        makeSubagent('x1', 'other'),
      ],
    );

    expect(wrapper.findAll('.annex__cube')).toHaveLength(2);
    expect(wrapper.find('[data-sub="x1"]').exists()).toBe(false);
    const working = wrapper.get('[data-sub="a1"]');
    expect(working.classes()).toEqual(['annex__cube', 'annex__cube--working']);
    expect(working.get('.annex__activity').text()).toBe('Read: a.ts');
    expect(working.find('.room__code').exists()).toBe(true);
    const done = wrapper.get('[data-sub="a2"]');
    expect(done.classes()).toEqual(['annex__cube', 'annex__cube--done', 'annex__cube--child']);
    expect(done.find('.annex__tick').exists()).toBe(true);
    expect(done.get('.annex__activity').text()).toBe('handed back');
    expect(done.attributes('data-name')).toBe('Explore: look around');
    expect(wrapper.findAll('.annex__pipe')).toHaveLength(3);
    expect(wrapper.findAll('.annex__pipe--nested')).toHaveLength(1);
    expect(wrapper.findAll('.annex__mail')).toHaveLength(1);
    expect(wrapper.get('svg').attributes('aria-label')).toBe('demo building with 1 session and 2 subagents');
  });

  it('keeps the same elements and updates their text when a new state arrives', async () => {
    const wrapper = openDemo([makeSession('s1')], [makeSubagent('a1', 's1')]);
    const room = wrapper.get('[data-room="s1"]').element;
    const cubicle = wrapper.get('[data-sub="a1"]').element;

    setDashboardState(
      makeState(
        [makeSession('s1', { tokens: { input: 9000, output: 1000, cacheRead: 0, cacheWrite: 0 } })],
        [makeSubagent('a1', 's1', { activity: 'Grep: needle' })],
      ),
    );
    await nextTick();

    expect(wrapper.get('[data-room="s1"]').element).toBe(room);
    expect(wrapper.get('[data-sub="a1"]').element).toBe(cubicle);
    expect(wrapper.get('.room__stat').text()).toMatch(/^10\.0k tokens/);
    expect(wrapper.get('[data-sub="a1"] .annex__activity').text()).toBe('Grep: needle');
    expect(wrapper.get('[data-sub="a1"]').attributes('data-tip')).toContain('Now: Grep: needle');
  });

  it('adds a room when a session appears and follows the sign tint and the closing of the popup', async () => {
    const wrapper = openDemo([makeSession('s1')]);

    setDashboardState(makeState([makeSession('s1'), makeSession('s2', { startedAtMs: 5000 })], []));
    setOpenBuilding({ name: 'demo', tintClass: 'tint-5' });
    await nextTick();

    expect(wrapper.findAll('[data-room]').map((room) => room.attributes('data-room'))).toEqual(['s1', 's2']);
    expect(wrapper.get('.building__sign').classes()).toContain('tint-5');

    setOpenBuilding(null);
    await nextTick();
    expect(wrapper.find('svg').exists()).toBe(false);
  });

  it('escapes names instead of interpreting them as markup', () => {
    const wrapper = openDemo([makeSession('s1', { name: '<img src=x onerror=alert(1)>' })]);

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-room="s1"]').attributes('data-name')).toBe('<img src=x onerror=alert(1)>');
  });
});
