import type { DashboardState, ProjectInfo } from '../../../shared/types/index.ts';
import { patchHtml } from '../../app/patch.ts';
import { elementById } from '../../shared/dom.ts';
import { esc } from '../../shared/escape.ts';
import { projectColor } from '../../shared/project-colors.ts';
import { timeSpan } from '../../shared/time.ts';
import { formatTokenCount } from '../../shared/token-format.ts';

const TRUST_TOOLTIP = 'Run claude once in this folder and accept the trust prompt to allow background tasks.';

function subagentsText(workingCount: number): string {
  if (!workingCount) return '';
  return ` · ${workingCount} subagent${workingCount === 1 ? '' : 's'} working`;
}

function projectCardHtml(project: ProjectInfo, state: DashboardState): string {
  const workingCount = state.subagents.filter((subagent) => subagent.project === project.name && subagent.state === 'working').length;
  const trustNote = state.features.commands && !project.trusted ? ` · <span data-tip="${TRUST_TOOLTIP}">not trusted for tasks</span>` : '';
  return `<div class="card card--click" data-key="${esc(project.name)}" data-building="${esc(project.name)}" role="button" tabindex="0" aria-label="${esc(`Open the ${project.name} building`)}">
        <div class="card__head"><span><span class="card__swatch" style="background:${projectColor(project.name)}"></span>${esc(project.name)}</span>
          <span class="badge ${project.liveSessions ? 'badge--live' : ''}">${project.liveSessions ? `${project.liveSessions} live` : 'idle'}</span></div>
        <div class="sub">${project.branch ? esc(project.branch) : 'no git'}${project.isWorktree ? ' · worktree' : ''}${trustNote}</div>
        <div class="sub">active ${timeSpan('ago', project.lastActiveMs)}${subagentsText(workingCount)}</div>
        <div class="sub">today ${formatTokenCount(project.tokensToday)} · 7d ${formatTokenCount(project.tokens7d)} tokens</div></div>`;
}

/** Draw the project cards into `#projects`. */
export function renderProjects(state: DashboardState): void {
  const cards = state.projects.map((project) => projectCardHtml(project, state)).join('');
  patchHtml(elementById('projects'), `<h2 id="h-projects">Projects</h2><div class="grid">${cards}</div>`);
}
