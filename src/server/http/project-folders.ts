import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normPath } from '../config.ts';

/** Folder names directly under the projects root, without hidden ones. */
export function listProjectNames(projectsRoot: string): string[] {
  try {
    return readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** A session folder is only usable for commands if it lies inside one of the listed projects. */
export function isInsideProject(cwd: string, projectsRoot: string): boolean {
  const normalizedCwd = normPath(cwd);
  return listProjectNames(projectsRoot).some((name) => {
    const projectPath = normPath(join(projectsRoot, name));
    return normalizedCwd === projectPath || normalizedCwd.startsWith(projectPath + '\\');
  });
}
