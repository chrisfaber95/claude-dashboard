import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SubagentInfo } from '../../../../src/shared/types/index.ts';
import { countWorkingSubagents, subagentsText } from '../../../../src/client/features/projects/projects.logic.ts';

function makeSubagent(project: string, state: SubagentInfo['state']): SubagentInfo {
  return {
    agentId: 'agent',
    sessionId: 'session',
    project,
    agentType: 'general-purpose',
    description: '',
    prompt: '',
    background: false,
    parentAgentId: null,
    startedAtMs: 0,
    lastTsMs: 0,
    state,
    handedBack: false,
    activity: '',
    result: '',
    tokens: 0,
  };
}

test('countWorkingSubagents counts only working subagents of the project', () => {
  const subagents = [makeSubagent('a', 'working'), makeSubagent('a', 'done'), makeSubagent('b', 'working'), makeSubagent('a', 'working')];
  assert.equal(countWorkingSubagents(subagents, 'a'), 2);
  assert.equal(countWorkingSubagents(subagents, 'c'), 0);
});

test('subagentsText is empty for none and pluralises', () => {
  assert.equal(subagentsText(0), '');
  assert.equal(subagentsText(1), ' · 1 subagent working');
  assert.equal(subagentsText(3), ' · 3 subagents working');
});
