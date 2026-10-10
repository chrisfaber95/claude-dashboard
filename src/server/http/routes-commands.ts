import { join } from 'node:path';
import { CommandError, audit, startTask, validateMode } from '../claude/claude-cli.ts';
import { GOAL_AUDIT_MAX, composeLaunch } from '../features/launch/launch.ts';
import type { RouteHandler } from './context.ts';
import { listProjectNames } from './project-folders.ts';
import { readJson } from './request-body.ts';
import { send } from './respond.ts';

/** Start a background task in one of the listed projects. */
export const handleCommandRoutes: RouteHandler = async (context, call) => {
  const { url, method, req, res, ip, actor } = call;
  if (url.pathname !== '/api/commands' || method !== 'POST') return false;
  if (!context.areCommandsEnabled) throw new CommandError(404, 'commands are disabled');
  const body = await readJson(req);
  if (typeof body.project !== 'string' || !body.project) throw new CommandError(400, 'project is required');
  const project = body.project;
  if (!listProjectNames(context.projectsRoot).includes(project)) throw new CommandError(400, 'unknown project');
  const launch = composeLaunch(body);
  const mode = validateMode(body.permissionMode);
  const result = await startTask(join(context.projectsRoot, project), launch.prompt, mode, context.getSettingsFile());
  audit({
    ip,
    ...actor,
    action: 'start',
    project,
    mode,
    goal: launch.goal.slice(0, GOAL_AUDIT_MAX),
    notesLength: launch.notesLength,
    ok: result.ok,
    id: result.id,
    session: result.id,
  });
  // A failed start leaves no session behind; say so next to the reason.
  send(res, 200, result.ok ? { ...result, started: true } : { ...result, started: false });
  return true;
};
