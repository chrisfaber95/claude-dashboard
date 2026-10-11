import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDashboardState } from '../../../../src/client/app/dashboard-state.ts';
import { setOpenPopup } from '../../../../src/client/features/popups/open-popup.ts';
import PopupShell from '../../../../src/client/features/popups/popup-shell.vue';
import { POPUPS } from '../../../../src/client/features/popups/popups.logic.ts';
import type { DashboardState } from '../../../../src/shared/types/index.ts';

// The panels have their own specs; here they are empty so the shell is tested on its own.
vi.mock('../../../../src/client/features/projects/projects-panel.vue', () => ({ default: { template: '<p>projects panel</p>' } }));
vi.mock('../../../../src/client/features/messages/messages-panel.vue', () => ({ default: { template: '<p>comms panel</p>' } }));
vi.mock('../../../../src/client/features/team/team-panel.vue', () => ({ default: { template: '<p>team panel</p>' } }));
vi.mock('../../../../src/client/features/usage/usage-panel.vue', () => ({ default: { template: '<p>usage panel</p>' } }));
vi.mock('../../../../src/client/features/chat/chat-panel.vue', () => ({ default: { template: '<p>chat panel</p>' } }));
vi.mock('../../../../src/client/features/settings/summary-setting.vue', () => ({ default: { template: '<p>summary</p>' } }));
vi.mock('../../../../src/client/features/controls/run-panel.vue', () => ({ default: { template: '<p>run panel</p>' } }));
vi.mock('../../../../src/client/features/devices/devices-panel.vue', () => ({ default: { template: '<p>devices panel</p>' } }));
vi.mock('../../../../src/client/features/audit/audit-panel.vue', () => ({ default: { template: '<p>audit panel</p>' } }));
vi.mock('../../../../src/client/features/permissions/approvals-panel.vue', () => ({ default: { template: '<p>approvals panel</p>' } }));

function makeState(commands: boolean, manageDevices: boolean): DashboardState {
  return {
    generatedAtMs: 1,
    projects: [],
    sessions: [],
    subagents: [],
    messages: [],
    usage: { days: [], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, byModel: {} },
    limits: { source: 'none', fetchedAtMs: null, error: null, windows: [], hits: [] },
    recentSessions: [],
    features: { lan: false, commands, permissionModes: [], manageDevices },
    team: null,
    alerts: { items: [], threshold: 80 },
    permissions: [],
  };
}

function buttonFor(id: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[data-popup="${id}"]`);
  if (!found) throw new Error(`no button ${id}`);
  return found;
}

function popupFor(id: string): HTMLElement {
  const found = document.getElementById(`popup-${id}`);
  if (!found) throw new Error(`no popup ${id}`);
  return found;
}

function overlay(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.popups');
  if (!found) throw new Error('no overlay');
  return found;
}

function closeButtonOf(id: string): HTMLButtonElement {
  const found = popupFor(id).querySelector<HTMLButtonElement>('.popup__close');
  if (!found) throw new Error(`no close button ${id}`);
  return found;
}

describe('popup shell', () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    setDashboardState(makeState(true, true));
    wrapper = mount(PopupShell, { attachTo: document.body });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    setOpenPopup(null);
    document.body.innerHTML = '';
  });

  it('renders a button and a dialog per popup, labelled from POPUPS', () => {
    for (const popup of POPUPS) {
      expect(buttonFor(popup.id).textContent?.trim()).toBe(popup.label);
      const dialog = popupFor(popup.id);
      expect(dialog.getAttribute('role')).toBe('dialog');
      expect(dialog.getAttribute('aria-label')).toBe(popup.label);
      expect(closeButtonOf(popup.id).getAttribute('aria-label')).toBe(`Close ${popup.label}`);
    }
    expect(overlay().hidden).toBe(true);
  });

  it('opens one popup at a time, switches, and a second click on its button closes it', async () => {
    buttonFor('usage').click();
    await flushPromises();
    expect(overlay().hidden).toBe(false);
    expect(popupFor('usage').hidden).toBe(false);
    expect(buttonFor('usage').getAttribute('aria-expanded')).toBe('true');

    buttonFor('chat').click();
    await flushPromises();
    expect(popupFor('usage').hidden).toBe(true);
    expect(popupFor('chat').hidden).toBe(false);
    expect(buttonFor('usage').getAttribute('aria-expanded')).toBe('false');

    buttonFor('chat').click();
    await flushPromises();
    expect(overlay().hidden).toBe(true);
  });

  it('puts focus on the Close button when opening and back on the opener when closing', async () => {
    const opener = buttonFor('projects');
    opener.focus();
    opener.click();
    await flushPromises();
    expect(document.activeElement).toBe(closeButtonOf('projects'));

    closeButtonOf('projects').click();
    await flushPromises();
    expect(overlay().hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('closes on a backdrop click but not on a click inside the popup', async () => {
    buttonFor('projects').click();
    await flushPromises();
    popupFor('projects').click();
    await flushPromises();
    expect(overlay().hidden).toBe(false);

    overlay().click();
    await flushPromises();
    expect(overlay().hidden).toBe(true);
  });

  it('closes on Escape, but a building dialog or drawer open above takes the key first', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="building"></div><div id="drawer" hidden></div>');
    buttonFor('projects').click();
    await flushPromises();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(overlay().hidden).toBe(false);

    const building = document.getElementById('building');
    if (building) building.hidden = true;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(overlay().hidden).toBe(true);
  });

  it('hides the buttons the state does not allow and closes a popup that went away', async () => {
    setDashboardState(makeState(false, false));
    await flushPromises();
    for (const id of ['team', 'run', 'approvals', 'devices']) expect(buttonFor(id).hidden).toBe(true);
    expect(buttonFor('projects').hidden).toBe(false);

    setDashboardState(makeState(true, true));
    await flushPromises();
    buttonFor('run').click();
    await flushPromises();
    expect(overlay().hidden).toBe(false);

    setDashboardState(makeState(false, false));
    await flushPromises();
    expect(overlay().hidden).toBe(true);
  });
});
