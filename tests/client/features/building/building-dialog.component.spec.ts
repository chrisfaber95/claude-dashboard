import { mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import BuildingDialog from '../../../../src/client/features/building/building-dialog.vue';
import { setOpenBuilding } from '../../../../src/client/features/building/building-selection.ts';
import type { DashboardState, ProjectInfo, SessionInfo } from '../../../../src/shared/types/index.ts';

const transcriptCalls = vi.hoisted((): { session: string[]; subagent: string[] } => ({ session: [], subagent: [] }));

vi.mock('../../../../src/client/features/controls/transcript-drawer-selection.ts', () => ({
  openTranscript: (sessionId: string): void => {
    transcriptCalls.session.push(sessionId);
  },
  openSubagentTranscript: (agentId: string): void => {
    transcriptCalls.subagent.push(agentId);
  },
}));

function makeProject(name: string): ProjectInfo {
  return {
    name,
    path: `N:/Projects/${name}`,
    branch: 'main',
    isWorktree: false,
    lastActiveMs: 1,
    liveSessions: 1,
    trusted: true,
    tokensToday: 0,
    tokens7d: 0,
    tokensTotal: 0,
  };
}

function makeSession(id: string, project: string): SessionInfo {
  return {
    sessionId: id,
    pid: 1,
    name: `Session ${id}`,
    project,
    cwd: `N:/Projects/${project}`,
    status: 'busy',
    entrypoint: 'cli',
    kind: 'interactive',
    startedAtMs: 1000,
    updatedAtMs: 2000,
    branch: 'main',
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  };
}

function makeState(projects: ProjectInfo[], sessions: SessionInfo[]): DashboardState {
  return {
    generatedAtMs: 1,
    projects,
    sessions,
    subagents: [],
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

function isDialogHidden(): boolean {
  const dialog = document.getElementById('building');
  return dialog ? dialog.hasAttribute('hidden') : true;
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('BuildingDialog', () => {
  let wrapper: VueWrapper;
  let drawer: HTMLElement;
  let card: HTMLElement;

  async function openDemo(): Promise<void> {
    card.click();
    await nextTick();
    await nextTick();
  }

  beforeEach(() => {
    transcriptCalls.session.length = 0;
    transcriptCalls.subagent.length = 0;
    drawer = document.createElement('aside');
    drawer.id = 'drawer';
    drawer.hidden = true;
    card = document.createElement('button');
    card.dataset.building = 'demo';
    document.body.append(drawer, card);
    setDashboardState(makeState([makeProject('demo')], [makeSession('s1', 'demo')]));
    wrapper = mount(BuildingDialog, { attachTo: document.body });
  });

  afterEach(() => {
    wrapper.unmount();
    setOpenBuilding(null);
    document.body.replaceChildren();
  });

  it('is hidden until a project card is clicked, then shows title and subtitle and focuses Close', async () => {
    expect(isDialogHidden()).toBe(true);

    await openDemo();

    expect(isDialogHidden()).toBe(false);
    expect(wrapper.get('#building-title').text()).toBe('demo');
    expect(wrapper.get('#building-sub').text()).toContain('1 session in the building');
    expect(document.activeElement).toBe(wrapper.get('#building-close').element);
    expect(wrapper.find('[data-room="s1"]').exists()).toBe(true);
  });

  it('follows a new state push while open', async () => {
    await openDemo();

    setDashboardState(makeState([makeProject('demo')], [makeSession('s1', 'demo'), makeSession('s2', 'demo')]));
    await nextTick();

    expect(wrapper.get('#building-sub').text()).toContain('2 sessions in the building');
    expect(wrapper.find('[data-room="s2"]').exists()).toBe(true);
  });

  it('closes when the project disappears and stays closed if it comes back', async () => {
    await openDemo();

    setDashboardState(makeState([], []));
    await nextTick();
    expect(isDialogHidden()).toBe(true);

    setDashboardState(makeState([makeProject('demo')], []));
    await nextTick();
    expect(isDialogHidden()).toBe(true);
  });

  it('closes on Close and returns focus to the card', async () => {
    await openDemo();

    await wrapper.get('#building-close').trigger('click');

    expect(isDialogHidden()).toBe(true);
    expect(document.activeElement).toBe(card);
  });

  it('closes on a backdrop click but not on a click inside the panel', async () => {
    await openDemo();

    await wrapper.get('.building__panel').trigger('click');
    expect(isDialogHidden()).toBe(false);

    await wrapper.get('#building').trigger('click');
    expect(isDialogHidden()).toBe(true);
  });

  it('closes on Escape, but not while the transcript drawer is open', async () => {
    await openDemo();
    drawer.hidden = false;

    pressEscape();
    await nextTick();
    expect(isDialogHidden()).toBe(false);

    drawer.hidden = true;
    pressEscape();
    await nextTick();
    expect(isDialogHidden()).toBe(true);
  });

  it('opens the transcript of a clicked room, and of a room activated with Enter', async () => {
    await openDemo();

    await wrapper.get('[data-room="s1"]').trigger('click');
    await wrapper.get('[data-room="s1"]').trigger('keydown', { key: 'Enter' });

    expect(transcriptCalls.session).toEqual(['s1', 's1']);
    expect(isDialogHidden()).toBe(false);
  });
});
