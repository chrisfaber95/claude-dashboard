import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TranscriptEntry } from '../../../../src/shared/types/index.ts';
import { isLiveElsewhere, mergeLiveTail } from '../../../../src/client/features/controls/transcript-drawer.logic.ts';

function entry(uuid: string): TranscriptEntry {
  return { uuid, tsMs: 1, role: 'user', text: uuid };
}

const uuids = (entries: TranscriptEntry[]): string[] => entries.map((item) => item.uuid);

describe('mergeLiveTail', () => {
  it('keeps earlier pages and replaces the overlapping tail', () => {
    const merged = mergeLiveTail([entry('a'), entry('b'), entry('c')], [entry('c'), entry('d')]);
    assert.deepEqual(uuids(merged), ['a', 'b', 'c', 'd']);
  });

  it('takes the tail as is when it does not overlap what is shown', () => {
    assert.deepEqual(uuids(mergeLiveTail([entry('a')], [entry('x'), entry('y')])), ['x', 'y']);
  });

  it('takes an empty tail as is', () => {
    assert.deepEqual(mergeLiveTail([entry('a')], []), []);
  });
});

describe('isLiveElsewhere', () => {
  const sessions = [
    { sessionId: 'one', kind: 'interactive' },
    { sessionId: 'two', kind: 'bg' },
  ];

  it('is true for a session running outside the dashboard', () => {
    assert.equal(isLiveElsewhere('one', sessions), true);
  });

  it('is false for a background session or an unknown one', () => {
    assert.equal(isLiveElsewhere('two', sessions), false);
    assert.equal(isLiveElsewhere('three', sessions), false);
  });
});
